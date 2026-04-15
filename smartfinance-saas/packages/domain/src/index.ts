export * from "./bootstrap";
export {
  buildManualRuleUpsert,
  classifyTransaction,
  deriveRuleIdentity,
  extractMerchant,
  getRuleScopes,
  matchRules,
  normalizeBankDescription,
  scoreRuleMatch as scoreCategorizationRuleMatch,
} from "./categorization";
export type {
  CategorizationDirection,
  CategorizationSettings,
  CategorizationStatus,
  MatchDecision,
  MerchantDictionaryEntry,
  RuleCandidate,
  RuleMode,
  TransactionForCategorization,
} from "./categorization";
export * from "./parsing";
export * from "./plans";
export * from "./rules";
