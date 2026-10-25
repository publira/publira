-- VIEW: billed_subscriptions
-- The subscriptions Stripe goes on billing: the ones a reader may not start a
-- second checkout beside, and the ones closing the account cancels. An
-- incomplete one is not among them, since Stripe drops it unless its first
-- payment goes through, and it becomes active if that payment does.
CREATE VIEW billed_subscriptions WITH (security_invoker = true) AS
SELECT s.*
FROM subscriptions s
WHERE s.status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');
