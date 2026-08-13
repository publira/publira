-- name: GetPlatformConfig :one
-- プラットフォーム全体設定の singleton 行を取得する
SELECT *
FROM platform_config
WHERE singleton = TRUE
LIMIT 1;

-- name: UpsertPlatformDefaultTimezone :one
-- プラットフォーム既定タイムゾーン (IANA 名) を作成または更新する
INSERT INTO platform_config (singleton, default_timezone, updated_at)
VALUES (TRUE, sqlc.arg('default_timezone'), NOW()) ON CONFLICT (singleton) DO
UPDATE
SET default_timezone = EXCLUDED.default_timezone,
    updated_at = NOW()
RETURNING *;
