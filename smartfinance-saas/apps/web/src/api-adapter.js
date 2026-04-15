import { api, getTokenGetter, requestCompat, setTokenGetter } from "./api-core";

api.completeGuidedCategorizationOnboarding = () =>
  requestCompat("/api/onboard/guided-categorization/complete", { method: "POST" });
api.skipGuidedCategorizationOnboarding = () =>
  requestCompat("/api/onboard/guided-categorization/skip", { method: "POST" });

export { api, getTokenGetter, setTokenGetter };
