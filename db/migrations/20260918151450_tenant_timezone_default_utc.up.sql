-- A tenant nobody placed in a zone is on UTC, the zone every process that runs
-- Publira keeps. Only the column defaults move; rows already written keep the
-- value they hold.
ALTER TABLE tenants ALTER COLUMN timezone SET DEFAULT 'UTC'::text;
ALTER TABLE platform_config ALTER COLUMN default_timezone SET DEFAULT 'UTC'::text;
