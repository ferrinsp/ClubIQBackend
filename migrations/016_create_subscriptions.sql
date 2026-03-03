CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  plan_id                TEXT NOT NULL DEFAULT 'beta',
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  billing_interval       TEXT NOT NULL DEFAULT 'monthly'
                           CHECK (billing_interval IN ('monthly', 'annual')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_subscriptions_club ON subscriptions(club_id);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_isolation ON subscriptions
  USING (club_id::text = current_setting('app.current_club_id', true));
