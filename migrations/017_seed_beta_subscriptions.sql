-- Backfill: give every existing club a beta subscription
INSERT INTO subscriptions (club_id, plan_id, status, billing_interval)
SELECT id, 'beta', 'active', 'monthly' FROM clubs
WHERE id NOT IN (SELECT club_id FROM subscriptions);

-- Auto-create beta subscription for new club signups
CREATE OR REPLACE FUNCTION auto_create_beta_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (club_id, plan_id, status, billing_interval)
  VALUES (NEW.id, 'beta', 'active', 'monthly');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_beta_subscription
  AFTER INSERT ON clubs
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_beta_subscription();
