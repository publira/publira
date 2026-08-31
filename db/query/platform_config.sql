-- name: GetPlatformConfig :one
-- プラットフォーム全体設定の singleton 行を取得する
SELECT *
FROM platform_config
WHERE singleton = TRUE
LIMIT 1;

-- name: UpsertPlatformSettings :one
-- プラットフォーム既定タイムゾーンと既定ロケールを原子的に作成または更新する。
-- default_locale は列 DEFAULT を持たないため、呼び出し側が必ず明示する。
INSERT INTO platform_config (singleton, default_timezone, default_locale, updated_at)
VALUES (
        TRUE,
        sqlc.arg('default_timezone'),
        sqlc.arg('default_locale'),
        NOW()
    ) ON CONFLICT (singleton) DO
UPDATE
SET default_timezone = EXCLUDED.default_timezone,
    default_locale = EXCLUDED.default_locale,
    updated_at = NOW()
RETURNING *;
