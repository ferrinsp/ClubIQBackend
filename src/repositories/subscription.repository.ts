import { query, pool } from '../db.js';

export interface SubscriptionRow {
  id: string;
  plan_id: string;
  status: string;
  billing_interval: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export async function getSubscription(clubId: string): Promise<SubscriptionRow | null> {
  const { rows } = await query<SubscriptionRow>(
    `SELECT id, plan_id, status, billing_interval, stripe_customer_id,
            stripe_subscription_id, current_period_start, current_period_end,
            cancel_at_period_end, created_at, updated_at
     FROM subscriptions WHERE club_id = $1`,
    [clubId],
  );
  return rows[0] ?? null;
}

export async function getStripeCustomerId(clubId: string): Promise<string | null> {
  const { rows } = await query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM subscriptions WHERE club_id = $1',
    [clubId],
  );
  return rows[0]?.stripe_customer_id ?? null;
}

export async function setStripeCustomerId(clubId: string, customerId: string): Promise<void> {
  await query(
    'UPDATE subscriptions SET stripe_customer_id = $1, updated_at = now() WHERE club_id = $2',
    [customerId, clubId],
  );
}

export async function activateSubscription(
  clubId: string,
  data: { planId: string; stripeSubId: string; stripeCustomerId: string; billingInterval: string; periodStart: number | null; periodEnd: number | null },
): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET
       plan_id = $1, status = 'active', stripe_subscription_id = $2,
       stripe_customer_id = $3, billing_interval = $4,
       current_period_start = to_timestamp($5),
       current_period_end = to_timestamp($6),
       updated_at = now()
     WHERE club_id = $7`,
    [data.planId, data.stripeSubId, data.stripeCustomerId, data.billingInterval, data.periodStart, data.periodEnd, clubId],
  );
}

export async function updateSubscriptionStatus(
  stripeSubId: string,
  data: { status: string; periodStart: number | null; periodEnd: number | null; cancelAtPeriodEnd: boolean },
): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET
       status = $1,
       current_period_start = to_timestamp($2),
       current_period_end = to_timestamp($3),
       cancel_at_period_end = $4,
       updated_at = now()
     WHERE stripe_subscription_id = $5`,
    [data.status, data.periodStart, data.periodEnd, data.cancelAtPeriodEnd, stripeSubId],
  );
}

export async function cancelSubscription(stripeSubId: string): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET status = 'canceled', updated_at = now()
     WHERE stripe_subscription_id = $1`,
    [stripeSubId],
  );
}

export async function markPastDue(stripeSubId: string): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET status = 'past_due', updated_at = now()
     WHERE stripe_subscription_id = $1`,
    [stripeSubId],
  );
}
