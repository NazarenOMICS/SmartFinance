export type PlanCode = "free" | "pro_monthly" | "pro_yearly";

export type PlanDefinition = {
  code: PlanCode;
  isPaid: boolean;
  capabilities: {
    exportsEnabled: boolean;
    aiAssistedImports: boolean;
  };
  limits: {
    accounts: number;
    uploadsPerMonth: number;
    ocrPagesPerMonth: number;
    aiRequestsPerMonth: number;
    maxUploadSizeMb: number;
  };
};

const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  free: {
    code: "free",
    isPaid: false,
    capabilities: {
      exportsEnabled: false,
      aiAssistedImports: true,
    },
    limits: {
      accounts: 3,
      uploadsPerMonth: 10,
      ocrPagesPerMonth: 25,
      aiRequestsPerMonth: 30,
      maxUploadSizeMb: 8,
    },
  },
  pro_monthly: {
    code: "pro_monthly",
    isPaid: true,
    capabilities: {
      exportsEnabled: true,
      aiAssistedImports: true,
    },
    limits: {
      accounts: 25,
      uploadsPerMonth: 200,
      ocrPagesPerMonth: 600,
      aiRequestsPerMonth: 800,
      maxUploadSizeMb: 25,
    },
  },
  pro_yearly: {
    code: "pro_yearly",
    isPaid: true,
    capabilities: {
      exportsEnabled: true,
      aiAssistedImports: true,
    },
    limits: {
      accounts: 25,
      uploadsPerMonth: 200,
      ocrPagesPerMonth: 600,
      aiRequestsPerMonth: 800,
      maxUploadSizeMb: 25,
    },
  },
};

export function getDefaultPlanCode(): PlanCode {
  return "free";
}

export function getPlanDefinition(planCode: string | null | undefined): PlanDefinition {
  if (!planCode || !(planCode in PLAN_DEFINITIONS)) {
    return PLAN_DEFINITIONS[getDefaultPlanCode()];
  }

  return PLAN_DEFINITIONS[planCode as PlanCode];
}
