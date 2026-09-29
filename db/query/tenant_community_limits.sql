-- name: GetTenantCommunityLimitOverrides :one
SELECT * FROM tenant_community_limit_overrides WHERE tenant_id = sqlc.arg('tenant_id');

-- name: LockTenantCommunityLimitOverrides :one
SELECT * FROM tenant_community_limit_overrides WHERE tenant_id = sqlc.arg('tenant_id') FOR UPDATE;

-- name: InsertTenantCommunityLimitOverrides :one
INSERT INTO tenant_community_limit_overrides (
 tenant_id, comment_post_limit_per_minute, comment_post_limit_per_day,
 comment_report_limit_per_minute, comment_report_limit_per_day, comment_duplicate_window_minutes,
 episode_rating_limit_per_minute, episode_rating_limit_per_day,
 contact_message_limit_per_account_per_hour, contact_message_limit_per_account_per_day,
 contact_message_limit_per_client_per_hour, contact_message_limit_per_client_per_day,
 viewer_preferences_limit_per_minute, viewer_preferences_limit_per_day, updated_at
) VALUES (
 sqlc.arg('tenant_id'), sqlc.narg('comment_post_limit_per_minute'), sqlc.narg('comment_post_limit_per_day'),
 sqlc.narg('comment_report_limit_per_minute'), sqlc.narg('comment_report_limit_per_day'), sqlc.narg('comment_duplicate_window_minutes'),
 sqlc.narg('episode_rating_limit_per_minute'), sqlc.narg('episode_rating_limit_per_day'),
 sqlc.narg('contact_message_limit_per_account_per_hour'), sqlc.narg('contact_message_limit_per_account_per_day'),
 sqlc.narg('contact_message_limit_per_client_per_hour'), sqlc.narg('contact_message_limit_per_client_per_day'),
 sqlc.narg('viewer_preferences_limit_per_minute'), sqlc.narg('viewer_preferences_limit_per_day'), NOW()
) RETURNING *;

-- name: UpdateTenantCommunityLimitOverrides :one
UPDATE tenant_community_limit_overrides SET
 comment_post_limit_per_minute = sqlc.narg('comment_post_limit_per_minute'), comment_post_limit_per_day = sqlc.narg('comment_post_limit_per_day'),
 comment_report_limit_per_minute = sqlc.narg('comment_report_limit_per_minute'), comment_report_limit_per_day = sqlc.narg('comment_report_limit_per_day'), comment_duplicate_window_minutes = sqlc.narg('comment_duplicate_window_minutes'),
 episode_rating_limit_per_minute = sqlc.narg('episode_rating_limit_per_minute'), episode_rating_limit_per_day = sqlc.narg('episode_rating_limit_per_day'),
 contact_message_limit_per_account_per_hour = sqlc.narg('contact_message_limit_per_account_per_hour'), contact_message_limit_per_account_per_day = sqlc.narg('contact_message_limit_per_account_per_day'),
 contact_message_limit_per_client_per_hour = sqlc.narg('contact_message_limit_per_client_per_hour'), contact_message_limit_per_client_per_day = sqlc.narg('contact_message_limit_per_client_per_day'),
 viewer_preferences_limit_per_minute = sqlc.narg('viewer_preferences_limit_per_minute'), viewer_preferences_limit_per_day = sqlc.narg('viewer_preferences_limit_per_day'),
 revision = revision + 1, updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id') RETURNING *;
