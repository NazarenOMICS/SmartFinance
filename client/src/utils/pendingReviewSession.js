const STORAGE_PREFIX = "sf_pending_review";

export function getPendingReviewStorageKey(userId) {
  return userId ? `${STORAGE_PREFIX}_${userId}` : null;
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
