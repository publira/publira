DROP INDEX IF EXISTS idx_series_tenant_published_at;
DROP INDEX IF EXISTS idx_series_tenant_created_at;
DROP INDEX IF EXISTS idx_series_tenant_public_id;

ALTER TABLE series
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS updated_by,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS is_published,
    DROP COLUMN IF EXISTS reading_period_hours,
    DROP COLUMN IF EXISTS synopsis;
