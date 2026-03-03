export interface PlanDefinition {
  id: string;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  playerLimit: number | null;
  userLimit: number | null;
  features: string[];
  stripePriceIdMonthly: string;
  stripePriceIdAnnual: string;
}

export const PLANS: Record<string, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPriceCents: 24900,
    annualPriceCents: 249000,
    playerLimit: 200,
    userLimit: 1,
    features: ['retention_dashboard', 'csv_upload', 'basic_revenue_forecast'],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? '',
    stripePriceIdAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL ?? '',
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthlyPriceCents: 59900,
    annualPriceCents: 599000,
    playerLimit: 500,
    userLimit: 3,
    features: ['retention_dashboard', 'csv_upload', 'basic_revenue_forecast', 'simulator', 'board_reports', 'email_alerts'],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? '',
    stripePriceIdAnnual: process.env.STRIPE_PRICE_GROWTH_ANNUAL ?? '',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceCents: 99900,
    annualPriceCents: 999000,
    playerLimit: null,
    userLimit: null,
    features: ['retention_dashboard', 'csv_upload', 'basic_revenue_forecast', 'simulator', 'board_reports', 'email_alerts', 'priority_support', 'custom_branding', 'api_access'],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? '',
  },
};

export const BETA_PLAN_ID = 'beta';

export function getPlan(planId: string): PlanDefinition | undefined {
  return PLANS[planId];
}

export function getAllPlans(): PlanDefinition[] {
  return Object.values(PLANS);
}
