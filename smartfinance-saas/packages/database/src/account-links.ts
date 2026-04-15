import type { CreateAccountLinkInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { getAccountById, listAccounts } from "./accounts";

type AccountLinkRow = {
  id: number;
  account_a_id: string;
  account_b_id: string;
  relation_type: string;
  preferred_currency: string | null;
  reconciled_pairs: number;
  last_reconciled_at: string | null;
  account_a_name: string | null;
  account_b_name: string | null;
  account_a_currency: string | null;
  account_b_currency: string | null;
  created_at: string;
};

export async function listAccountLinks(db: D1DatabaseLike, userId: string) {
  return allRows<AccountLinkRow>(
    db,
    `
      SELECT
        links.id,
        links.account_a_id,
        links.account_b_id,
        links.relation_type,
        links.preferred_currency,
        links.reconciled_pairs,
        links.last_reconciled_at,
        account_a.name AS account_a_name,
        account_b.name AS account_b_name,
        account_a.currency AS account_a_currency,
        account_b.currency AS account_b_currency,
        links.created_at
      FROM account_links links
      LEFT JOIN accounts account_a
        ON account_a.user_id = links.user_id
       AND account_a.id = links.account_a_id
      LEFT JOIN accounts account_b
        ON account_b.user_id = links.user_id
       AND account_b.id = links.account_b_id
      WHERE links.user_id = ?
      ORDER BY links.created_at DESC, links.id DESC
    `,
    [userId],
  );
}

export async function getAccountLinkById(db: D1DatabaseLike, userId: string, linkId: number) {
  return firstRow<AccountLinkRow>(
    db,
    `
      SELECT
        links.id,
        links.account_a_id,
        links.account_b_id,
        links.relation_type,
        links.preferred_currency,
        links.reconciled_pairs,
        links.last_reconciled_at,
        account_a.name AS account_a_name,
        account_b.name AS account_b_name,
        account_a.currency AS account_a_currency,
        account_b.currency AS account_b_currency,
        links.created_at
      FROM account_links links
      LEFT JOIN accounts account_a
        ON account_a.user_id = links.user_id
       AND account_a.id = links.account_a_id
      LEFT JOIN accounts account_b
        ON account_b.user_id = links.user_id
       AND account_b.id = links.account_b_id
      WHERE links.user_id = ? AND links.id = ?
      LIMIT 1
    `,
    [userId, linkId],
  );
}

export async function createAccountLink(db: D1DatabaseLike, userId: string, input: CreateAccountLinkInput) {
  const accountA = await getAccountById(db, userId, input.account_a_id);
  const accountB = await getAccountById(db, userId, input.account_b_id);
  if (!accountA || !accountB) {
    throw new Error("linked accounts must exist");
  }

  const [accountAId, accountBId] = [input.account_a_id, input.account_b_id].sort((left, right) => left.localeCompare(right));
  const relationType = accountA.currency === accountB.currency ? "internal_transfer" : "fx_pair";
  const result = await runStatement(
    db,
    `
      INSERT INTO account_links (
        user_id, account_a_id, account_b_id, relation_type, preferred_currency, reconciled_pairs, last_reconciled_at
      )
      VALUES (?, ?, ?, ?, ?, 0, NULL)
    `,
    [userId, accountAId, accountBId, relationType, input.preferred_currency || null],
  );

  return getAccountLinkById(db, userId, Number(result.meta?.last_row_id || 0));
}

export async function deleteAccountLink(db: D1DatabaseLike, userId: string, linkId: number) {
  const current = await getAccountLinkById(db, userId, linkId);
  if (!current) return { deleted: false };

  await runStatement(
    db,
    "DELETE FROM account_links WHERE user_id = ? AND id = ?",
    [userId, linkId],
  );

  await runStatement(
    db,
    `
      UPDATE transactions
      SET account_link_id = NULL,
          paired_transaction_id = NULL,
          internal_group_id = NULL,
          movement_kind = CASE
            WHEN movement_kind IN ('internal_transfer', 'fx_exchange') THEN 'normal'
            ELSE movement_kind
          END
      WHERE user_id = ? AND account_link_id = ?
    `,
    [userId, linkId],
  );

  return { deleted: true };
}

function normalizedAmount(value: number) {
  return Number(Math.abs(value).toFixed(2));
}

function dayDistance(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.abs((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

function scoreCounterpart(
  link: AccountLinkRow,
  source: {
    fecha: string;
    monto: number;
    moneda: string;
    account_id: string | null;
  },
  candidate: {
    fecha: string;
    monto: number;
    moneda: string;
    account_id: string | null;
  },
) {
  if (candidate.account_id === source.account_id) return 0;
  if (Number(source.monto) * Number(candidate.monto) >= 0) return 0;
  const distance = dayDistance(String(candidate.fecha), String(source.fecha));
  if (distance > 2) return 0;

  const sameCurrencyLink = String(link.account_a_currency || "") === String(link.account_b_currency || "");
  const sourceAmount = normalizedAmount(Number(source.monto));
  const candidateAmount = normalizedAmount(Number(candidate.monto));

  if (sameCurrencyLink) {
    if (candidate.moneda !== source.moneda) return 0;
    const delta = Math.abs(candidateAmount - sourceAmount) / Math.max(sourceAmount, 1);
    if (delta > 0.06) return 0;
    return 1.1 - delta - distance * 0.08;
  }

  let score = 0.65 - distance * 0.06;
  if (link.preferred_currency && candidate.moneda === link.preferred_currency) {
    score += 0.1;
  }
  if (candidate.moneda !== source.moneda) {
    score += 0.12;
  }
  const ratio = candidateAmount / Math.max(sourceAmount, 0.0001);
  if (ratio > 0.01 && ratio < 200) {
    score += 0.08;
  }
  return score;
}

export async function reconcileAccountLink(db: D1DatabaseLike, userId: string, linkId: number) {
  const link = await getAccountLinkById(db, userId, linkId);
  if (!link) return null;

  const transactions = await allRows<{
    id: number;
    fecha: string;
    monto: number;
    moneda: string;
    account_id: string | null;
    movement_kind: string;
  }>(
    db,
    `
      SELECT id, fecha, monto, moneda, account_id, movement_kind
      FROM transactions
      WHERE user_id = ?
        AND account_id IN (?, ?)
      ORDER BY fecha ASC, id ASC
    `,
    [userId, link.account_a_id, link.account_b_id],
  );

  const sourceSide = transactions.filter((transaction) => (
    transaction.account_id === link.account_a_id || transaction.account_id === link.account_b_id
  ));
  const usedIds = new Set<number>();
  let reconciledPairs = 0;

  for (const transaction of sourceSide) {
    if (usedIds.has(transaction.id) || Number(transaction.monto) === 0) continue;

    const counterpart = sourceSide
      .filter((candidate) => candidate.id !== transaction.id && !usedIds.has(candidate.id))
      .map((candidate) => ({
        candidate,
        score: scoreCounterpart(link, transaction, candidate),
      }))
      .filter((entry) => entry.score > 0.5)
      .sort((left, right) => right.score - left.score)[0]?.candidate;

    if (!counterpart) continue;

    const groupId = `link_${link.id}_${Math.min(transaction.id, counterpart.id)}_${Math.max(transaction.id, counterpart.id)}`;
    const movementKind = link.account_a_currency === link.account_b_currency ? "internal_transfer" : "fx_exchange";

    await runStatement(
      db,
      `
        UPDATE transactions
        SET movement_kind = ?,
            paired_transaction_id = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? ELSE paired_transaction_id END,
            account_link_id = ?,
            internal_group_id = ?,
            categorization_status = 'categorized',
            category_id = NULL,
            category_source = 'movement_kind',
            category_confidence = NULL,
            category_rule_id = NULL
        WHERE user_id = ? AND id IN (?, ?)
      `,
      [
        movementKind,
        transaction.id,
        counterpart.id,
        counterpart.id,
        transaction.id,
        link.id,
        groupId,
        userId,
        transaction.id,
        counterpart.id,
      ],
    );

    usedIds.add(transaction.id);
    usedIds.add(counterpart.id);
    reconciledPairs += 1;
  }

  await runStatement(
    db,
    `
      UPDATE account_links
      SET reconciled_pairs = COALESCE(reconciled_pairs, 0) + ?,
          last_reconciled_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `,
    [reconciledPairs, userId, linkId],
  );

  return {
    link: await getAccountLinkById(db, userId, linkId),
    reconciled_pairs: reconciledPairs,
  };
}

export async function listAccountsWithLinks(db: D1DatabaseLike, userId: string) {
  const [accounts, links] = await Promise.all([
    listAccounts(db, userId),
    listAccountLinks(db, userId),
  ]);

  return accounts.map((account) => {
    const linkedAccounts = links
      .filter((link) => link.account_a_id === account.id || link.account_b_id === account.id)
      .map((link) => {
        const isA = link.account_a_id === account.id;
        return {
          link_id: link.id,
          account_id: isA ? link.account_b_id : link.account_a_id,
          account_name: isA ? link.account_b_name : link.account_a_name,
          currency: isA ? link.account_b_currency : link.account_a_currency,
          relation_type: link.relation_type,
          preferred_currency: link.preferred_currency,
        };
      });

    return {
      ...account,
      linked_accounts: linkedAccounts,
    };
  });
}
