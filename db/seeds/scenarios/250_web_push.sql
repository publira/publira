-- Web Push, configured the way an operator leaves it after saving a subject.
-- Without it the public API publishes no VAPID key and the browser
-- notification switch is left out of /settings/notifications.
--
-- The server generates its own pair, but a generated pair is one no spec can
-- know in advance, so this stores a fixed one. The private key is sealed with
-- the E2E stack's secret encryption key (PUBLIRA_SECRET_ENCRYPTION_KEYS in
-- e2e/scripts/lib.sh), the way the server stores the pairs it generates. Nothing
-- is ever delivered through it: the specs stub the Push API.
INSERT INTO platform_webpush_config (
    singleton,
    vapid_public_key,
    vapid_private_key_encrypted,
    subject
)
VALUES (
    TRUE,
    'BLA9H4ThVuX8uYA1HMTOe0q51POeLNEvc-TtqSb5TKuztJM_UfKKQLLfbpm9Kr7jzikhThqoipdhx0NQgzfBDs0',
    'enc:v1:e2e:BXSdMuJJ2LrCPjOa:I6-tDXIz8sYzNmxyTYjZIanivgtEPmWYi6NhGXwOk1Re40biZhIbW_x490uwU-M8B1eowqfiHlf5yp4',
    'mailto:e2e@publira.test'
)
ON CONFLICT (singleton) DO UPDATE
SET vapid_public_key = EXCLUDED.vapid_public_key,
    vapid_private_key_encrypted = EXCLUDED.vapid_private_key_encrypted,
    subject = EXCLUDED.subject,
    updated_at = NOW();
