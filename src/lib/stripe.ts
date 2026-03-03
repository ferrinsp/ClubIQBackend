import Stripe from 'stripe';
import { env } from '../env.js';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, { typescript: true });
  }
  return _stripe;
}

export function getAppUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:5173';
}
