import type { RouteHandler } from '../types.js';
import { ok, badRequest, err } from '../lib/response.js';
import { query } from '../db.js';
import { extractAuth, isAuthError, requireRole } from '../middleware/auth.js';
import { env } from '../env.js';
import { z } from 'zod';
import { getAllPlans, getPlan, BETA_PLAN_ID } from '../lib/plans.js';
import { getStripe, getAppUrl } from '../lib/stripe.js';
import {
  getSubscription,
  getStripeCustomerId,
  setStripeCustomerId,
  activateSubscription,
  updateSubscriptionStatus,
  cancelSubscription,
  markPastDue,
} from '../repositories/subscription.repository.js';
import type Stripe from 'stripe';

/**
 * GET /billing
 * Returns the club's current subscription, plan details, and all available plans.
 */
export const getBillingHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, 'admin');
  if (roleCheck) return roleCheck;

  const sub = await getSubscription(auth.clubId);

  if (!sub) {
    return ok({
      subscription: null,
      plan: null,
      isBeta: true,
      plans: getAllPlans(),
    });
  }

  const plan = getPlan(sub.plan_id);
  const isBeta = sub.plan_id === BETA_PLAN_ID;

  return ok({
    subscription: {
      id: sub.id,
      planId: sub.plan_id,
      status: sub.status,
      billingInterval: sub.billing_interval,
      stripeCustomerId: sub.stripe_customer_id,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    },
    plan: plan ?? null,
    isBeta,
    plans: getAllPlans(),
  });
};

/**
 * GET /billing/plans
 * Public endpoint returning all available plan definitions.
 */
export const getPlansHandler: RouteHandler = async () => {
  return ok({ plans: getAllPlans() });
};

const checkoutSchema = z.object({
  planId: z.enum(['starter', 'growth', 'pro']),
  billingInterval: z.enum(['monthly', 'annual']),
});

/**
 * POST /billing/checkout
 * Creates a Stripe Checkout Session. Returns 503 during beta.
 */
export const createCheckoutHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, 'admin');
  if (roleCheck) return roleCheck;

  const stripe = getStripe();
  if (!stripe) {
    return err(503, 'BILLING_NOT_ACTIVE', 'Billing is not yet active. You are on the free beta.');
  }

  const body = JSON.parse(event.body ?? '{}');
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('planId and billingInterval are required');
  }

  const { planId, billingInterval } = parsed.data;
  const plan = getPlan(planId);
  if (!plan) return badRequest('Invalid plan');

  const priceId = billingInterval === 'annual'
    ? plan.stripePriceIdAnnual
    : plan.stripePriceIdMonthly;

  if (!priceId) {
    return err(503, 'PRICE_NOT_CONFIGURED', 'Stripe prices not yet configured');
  }

  // Get or create Stripe customer
  let customerId = await getStripeCustomerId(auth.clubId);
  if (!customerId) {
    const { rows: clubRows } = await query<{ name: string; primary_contact_email: string | null }>(
      'SELECT name, primary_contact_email FROM clubs WHERE id = $1',
      [auth.clubId],
    );
    const club = clubRows[0];

    const customer = await stripe.customers.create({
      name: club.name,
      email: club.primary_contact_email ?? undefined,
      metadata: { clubId: auth.clubId },
    });
    customerId = customer.id;

    await setStripeCustomerId(auth.clubId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${getAppUrl()}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getAppUrl()}/billing`,
    metadata: { clubId: auth.clubId, planId },
  });

  return ok({ checkoutUrl: session.url });
};

/**
 * POST /billing/portal
 * Creates a Stripe Customer Portal session. Returns 503 during beta.
 */
export const createPortalHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, 'admin');
  if (roleCheck) return roleCheck;

  const stripe = getStripe();
  if (!stripe) {
    return err(503, 'BILLING_NOT_ACTIVE', 'Billing is not yet active. You are on the free beta.');
  }

  const customerId = await getStripeCustomerId(auth.clubId);
  if (!customerId) {
    return badRequest('No billing account found. Please subscribe to a plan first.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppUrl()}/billing`,
  });

  return ok({ portalUrl: session.url });
};

/**
 * POST /billing/webhook
 * Stripe webhook handler. No auth — uses Stripe signature verification.
 */
export const webhookHandler: RouteHandler = async (event) => {
  const stripe = getStripe();
  if (!stripe) return ok({ received: true });

  const sig = event.headers['stripe-signature'];
  if (!sig) return err(400, 'MISSING_SIGNATURE', 'Missing Stripe signature');

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body ?? '',
      sig,
      env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return err(400, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      const clubId = session.metadata?.clubId;
      const planId = session.metadata?.planId;
      if (clubId && planId && session.subscription) {
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
        const firstItem = stripeSub.items.data[0];
        await activateSubscription(clubId, {
          planId,
          stripeSubId: stripeSub.id,
          stripeCustomerId: stripeSub.customer as string,
          billingInterval: firstItem?.price.recurring?.interval === 'year' ? 'annual' : 'monthly',
          periodStart: firstItem?.current_period_start ?? stripeSub.start_date,
          periodEnd: firstItem?.current_period_end ?? null,
        });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = stripeEvent.data.object as Stripe.Subscription;
      const item = sub.items.data[0];
      await updateSubscriptionStatus(sub.id, {
        status: sub.status,
        periodStart: item?.current_period_start ?? sub.start_date,
        periodEnd: item?.current_period_end ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object as Stripe.Subscription;
      await cancelSubscription(sub.id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = stripeEvent.data.object as Stripe.Invoice;
      const subDetails = invoice.parent?.subscription_details;
      const subId = typeof subDetails?.subscription === 'string'
        ? subDetails.subscription
        : subDetails?.subscription?.id;
      if (subId) {
        await markPastDue(subId);
      }
      break;
    }
    default:
      break;
  }

  return ok({ received: true });
};
