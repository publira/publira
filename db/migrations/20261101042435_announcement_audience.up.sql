-- The readers an announcement is addressed to, and the function that answers
-- who they are at the moment it is delivered.
--
-- The column is nullable, so the previous release's INSERT, which names no
-- audience, goes on posting for everyone. Its CHECK constraint is added NOT
-- VALID so this file takes its ACCESS EXCLUSIVE lock without scanning the
-- table; the next migration validates it under a lock that lets reads and
-- writes continue.

-- COLUMN: announcements audience
-- NULL addresses everyone who opens the site, which every announcement posted
-- before this column was. Otherwise it is {"version": 1, "conditions": [...]},
-- the conditions a reader has to meet all of, which
-- server/internal/announcementaudience validates before it is written and
-- before the worker delivers it. A targeted announcement is never pinned and never posted for
-- everyone: a banner is shown to every visitor, and a notice no reader may miss
-- is not one a condition may hide from some of them.
ALTER TABLE ONLY announcements
    ADD COLUMN audience jsonb,
    ADD CONSTRAINT announcements_audience_check CHECK (((audience IS NULL) OR ((jsonb_typeof(audience) = 'object'::text) AND (NOT pinned) AND (delivery = 'preferred'::text)))) NOT VALID;

-- FUNCTION: announcement_audience_members
-- Every user of the tenant an audience selects: all of them for a NULL
-- audience, else those who meet every condition. One that names a version or a
-- type this release does not know selects nobody, so an audience written by a
-- newer release is never widened into everyone by an older reader of it.
--
-- The subscription condition reads the statuses under which the episode_grants
-- view and db/query/subscription_plan.sql open a plan's episodes: 'trialing',
-- 'active' and 'past_due' are a live subscription. 'ended' is a reader with a
-- row in any other status ('canceled', 'incomplete_expired', 'unpaid',
-- 'paused', 'incomplete') and no live row beside it. A change to that set in
-- either place is a change here too.
--
-- A purchase counts unless it was a test of the payment provider. The bought
-- condition leaves out a purchase that has since been revoked, since that
-- reader no longer holds what they bought; never_purchased counts it, since
-- they did buy.
--
-- It is one SELECT, so the planner inlines it into the query that pages over
-- its answer.
CREATE FUNCTION announcement_audience_members(tenant_id uuid, audience jsonb) RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT u.id
    FROM users u
        JOIN tenants t ON t.id = u.tenant_id
    WHERE u.tenant_id = announcement_audience_members.tenant_id
        AND (
            announcement_audience_members.audience IS NULL
            OR (
                announcement_audience_members.audience ->> 'version' = '1'
                AND jsonb_typeof(announcement_audience_members.audience -> 'conditions') = 'array'
                AND jsonb_array_length(announcement_audience_members.audience -> 'conditions') > 0
                AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(announcement_audience_members.audience -> 'conditions') c(condition)
                    WHERE (
                        CASE c.condition ->> 'type'
                            WHEN 'follows_series' THEN EXISTS (
                                SELECT 1
                                FROM series_follows sf
                                WHERE sf.tenant_id = u.tenant_id
                                    AND sf.user_id = u.id
                                    AND sf.series_id = (c.condition ->> 'series_id')::uuid
                            )
                            WHEN 'bought_series_episode' THEN EXISTS (
                                SELECT 1
                                FROM purchases p
                                    LEFT JOIN episodes e ON e.tenant_id = p.tenant_id
                                    AND e.id = p.episode_id
                                    LEFT JOIN volumes v ON v.tenant_id = p.tenant_id
                                    AND v.id = p.volume_id
                                    LEFT JOIN series_bundles sb ON sb.tenant_id = p.tenant_id
                                    AND sb.id = p.series_bundle_id
                                WHERE p.tenant_id = u.tenant_id
                                    AND p.user_id = u.id
                                    AND NOT p.is_test
                                    AND p.revoked_at IS NULL
                                    AND COALESCE(e.series_id, v.series_id, sb.series_id) = (c.condition ->> 'series_id')::uuid
                            )
                            WHEN 'subscription' THEN CASE c.condition ->> 'state'
                                WHEN 'active' THEN EXISTS (
                                    SELECT 1
                                    FROM subscriptions s
                                    WHERE s.tenant_id = u.tenant_id
                                        AND s.user_id = u.id
                                        AND (c.condition ->> 'plan_id' IS NULL OR s.plan_id = (c.condition ->> 'plan_id')::uuid)
                                        AND s.status IN ('trialing', 'active', 'past_due')
                                )
                                WHEN 'ended' THEN EXISTS (
                                    SELECT 1
                                    FROM subscriptions s
                                    WHERE s.tenant_id = u.tenant_id
                                        AND s.user_id = u.id
                                        AND (c.condition ->> 'plan_id' IS NULL OR s.plan_id = (c.condition ->> 'plan_id')::uuid)
                                        AND s.status NOT IN ('trialing', 'active', 'past_due')
                                )
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM subscriptions s
                                    WHERE s.tenant_id = u.tenant_id
                                        AND s.user_id = u.id
                                        AND (c.condition ->> 'plan_id' IS NULL OR s.plan_id = (c.condition ->> 'plan_id')::uuid)
                                        AND s.status IN ('trialing', 'active', 'past_due')
                                )
                            END
                            WHEN 'never_purchased' THEN NOT EXISTS (
                                SELECT 1
                                FROM purchases p
                                WHERE p.tenant_id = u.tenant_id
                                    AND p.user_id = u.id
                                    AND NOT p.is_test
                            )
                            WHEN 'last_read_days_ago' THEN NOT EXISTS (
                                SELECT 1
                                FROM episode_reads er
                                WHERE er.tenant_id = u.tenant_id
                                    AND er.user_id = u.id
                                    AND er.read_at > NOW() - make_interval(days => (c.condition ->> 'days')::int)
                            )
                            WHEN 'signed_up_within_days' THEN u.created_at > NOW() - make_interval(days => (c.condition ->> 'days')::int)
                            -- A reader who never named a locale is sent the
                            -- tenant default locale's translation, so that is
                            -- the locale they are counted in.
                            WHEN 'locale' THEN COALESCE(u.last_locale, t.default_locale) = c.condition ->> 'locale'
                            WHEN 'has_mobile_push_device' THEN EXISTS (
                                SELECT 1
                                FROM user_push_devices d
                                WHERE d.tenant_id = u.tenant_id
                                    AND d.user_id = u.id
                                    AND d.platform IN ('android', 'ios')
                            )
                        END
                    ) IS NOT TRUE
                )
            )
        )
$$;
