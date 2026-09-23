\set ON_ERROR_STOP on

-- Development seed: includes production seed + local dev sample dataset.
\ir prod.sql

BEGIN;
\ir dev/001_tenant_users.sql
\set seed_tenant SeedTNNTAAA1
\ir creator_roles.sql
\ir dev/010_catalog.sql
\ir episode_creators.sql
\ir dev/020_audit_logs.sql
\ir dev/030_smtp_config.sql
\ir dev/040_pages.sql
\ir dev/050_access_tickets.sql
\ir dev/060_images.sql
\ir dev/070_follows.sql
\ir dev/080_purchases.sql
COMMIT;