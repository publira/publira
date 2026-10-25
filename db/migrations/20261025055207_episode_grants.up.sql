-- VIEW: episode_grants
-- Every grant that opens an episode to one reader: the grants
-- episode_content_grants holds, and a reader's subscription. Every query that
-- decides access reads this view from now on. The release before reads
-- episode_content_grants and fails a read whose grant kind it does not know,
-- so the subscription grant is added here and not there.
--
-- A subscription opens every episode in its plan's scope — the whole tenant,
-- the series of the labels the plan names, or the series it names — while
-- Stripe reports it trialing, active, or past due and the period it bills for
-- has not ended. Past due is the grace: Stripe is retrying a renewal that has
-- already moved the period on, and the tenant's retry settings in Stripe
-- decide when it gives up and the subscription becomes canceled or unpaid. The
-- period end is what stops a subscription set to cancel then, even before the
-- notification of its end arrives; one with no period recorded opens nothing.
--
-- A plan staff have since unpublished goes on opening its scope to the
-- readers who pay for it. A target is read by its plan's scope, so one that
-- does not match the scope opens nothing.
CREATE VIEW episode_grants WITH (security_invoker = true) AS
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.episode_id IS NOT NULL
    AND p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    ve.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
    AND ve.volume_id = p.volume_id
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    sbe.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN series_bundle_episodes sbe ON sbe.tenant_id = p.tenant_id
    AND sbe.series_bundle_id = p.series_bundle_id
WHERE p.revoked_at IS NULL
    AND (
        sbe.reading_period_hours IS NULL
        OR p.purchased_at + make_interval(hours => sbe.reading_period_hours) > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id
UNION ALL
SELECT tur.tenant_id,
    tur.user_id,
    e.id AS episode_id,
    'staff'::text AS kind,
    NULL::text AS purchase_kind
FROM tenant_user_roles tur
    JOIN episodes e ON e.tenant_id = tur.tenant_id
WHERE tur.role IN ('tenant_admin', 'tenant_editor', 'tenant_auditor')

UNION ALL
SELECT s.tenant_id,
    s.user_id,
    e.id AS episode_id,
    'subscription'::text AS kind,
    NULL::text AS purchase_kind
FROM subscriptions s
    JOIN subscription_plans sp ON sp.tenant_id = s.tenant_id
    AND sp.id = s.plan_id
    JOIN episodes e ON e.tenant_id = s.tenant_id
    JOIN series sr ON sr.tenant_id = e.tenant_id
    AND sr.id = e.series_id
WHERE s.status IN ('trialing', 'active', 'past_due')
    AND s.current_period_end > NOW()
    AND (
        sp.scope = 'all'
        OR EXISTS (
            SELECT 1
            FROM subscription_plan_targets t
            WHERE t.tenant_id = sp.tenant_id
                AND t.plan_id = sp.id
                AND (
                    (
                        sp.scope = 'series'
                        AND t.series_id = e.series_id
                    )
                    OR (
                        sp.scope = 'label'
                        AND t.label_id = sr.label_id
                    )
                )
        )
    );

-- FUNCTION: reader_may_open_episode
-- Reads episode_grants, so the release before opens the body to a subscriber
-- in the queries that ask through it too: what it answers is a boolean, which
-- that release reads whatever grant made it true.
CREATE OR REPLACE FUNCTION reader_may_open_episode(tenant_id uuid, user_id uuid, episode_id uuid) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.episode_id = reader_may_open_episode.episode_id
        )
        OR EXISTS (
            SELECT 1
            FROM episode_grants g
            WHERE g.tenant_id = reader_may_open_episode.tenant_id
                AND g.user_id = reader_may_open_episode.user_id
                AND g.episode_id = reader_may_open_episode.episode_id
        )
$$;
