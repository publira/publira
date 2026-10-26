ALTER TABLE episode_free_windows
    DROP CONSTRAINT IF EXISTS episode_free_windows_tenant_rule_series_id_fkey;

ALTER TABLE episode_free_windows
    DROP CONSTRAINT IF EXISTS episode_free_windows_rule_ends_check;

-- Without the column a rule's window would read as one an editor scheduled to
-- the far end, and nothing would remove it again.
DELETE FROM episode_free_windows
WHERE rule_series_id IS NOT NULL;

ALTER TABLE episode_free_windows
    DROP COLUMN IF EXISTS rule_series_id;

DROP TABLE IF EXISTS series_free_after_settings;
