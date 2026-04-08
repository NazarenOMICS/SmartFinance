const STORAGE_PREFIX = "sf_pending_review";
const GUIDED_STORAGE_PREFIX = "sf_pending_guided_review";

export function getPendingReviewStorageKey(userId) {
  return userId ? `${STORAGE_PREFIX}_${userId}` : null;
}

export function getPendingGuidedReviewStorageKey(userId) {
  return userId ? `${GUIDED_STORAGE_PREFIX}_${userId}` : null;
}

export function normalizePendingReviewSource(source) {
  if (source === "category_manager") return "rules";
  return source || "dashboard";
}

export function getPendingReviewTab(source) {
  const normalized = normalizePendingReviewSource(source);
  if (normalized === "rules" || normalized === "recurring" || normalized === "dashboard") {
    return normalized;
  }
  return "dashboard";
}

export function readPendingReviewSession(userId) {
  if (!userId || typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(getPendingReviewStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.pattern || !parsed?.categoryId) return null;

    return {
      source: normalizePendingReviewSource(parsed.source),
      pattern: parsed.pattern,
      categoryId: Number(parsed.categoryId),
      categoryName: parsed.categoryName || "",
      ruleId: parsed.ruleId ? Number(parsed.ruleId) : null,
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writePendingReviewSession(userId, session) {
  if (!userId || !session || typeof window === "undefined") return;

  const payload = {
    source: normalizePendingReviewSource(session.source),
    pattern: session.pattern,
    categoryId: Number(session.categoryId),
    categoryName: session.categoryName || "",
    ruleId: session.ruleId ? Number(session.ruleId) : null,
    createdAt: session.createdAt || new Date().toISOString(),
  };

  localStorage.setItem(getPendingReviewStorageKey(userId), JSON.stringify(payload));
}

export function clearPendingReviewSession(userId) {
  if (!userId || typeof window === "undefined") return;
  localStorage.removeItem(getPendingReviewStorageKey(userId));
}

export function readPendingGuidedReviewContext(userId) {
  if (!userId || typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(getPendingGuidedReviewStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const transactionIds = Array.isArray(parsed?.transactionIds)
      ? parsed.transactionIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];

    if (transactionIds.length === 0) return null;

    return {
      source: normalizePendingReviewSource(parsed.source || "upload"),
      month: parsed.month || null,
      accountId: parsed.accountId ? String(parsed.accountId) : null,
      transactionIds,
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writePendingGuidedReviewContext(userId, context) {
  if (!userId || !context || typeof window === "undefined") return;

  const transactionIds = Array.isArray(context.transactionIds)
    ? context.transactionIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (transactionIds.length === 0) {
    clearPendingGuidedReviewContext(userId);
    return;
  }

  localStorage.setItem(
    getPendingGuidedReviewStorageKey(userId),
    JSON.stringify({
      source: normalizePendingReviewSource(context.source || "upload"),
      month: context.month || null,
      accountId: context.accountId ? String(context.accountId) : null,
      transactionIds,
      createdAt: context.createdAt || new Date().toISOString(),
    })
  );
}

export function clearPendingGuidedReviewContext(userId) {
  if (!userId || typeof window === "undefined") return;
  localStorage.removeItem(getPendingGuidedReviewStorageKey(userId));
}
