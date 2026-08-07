\set ON_ERROR_STOP on

-- Development seed: includes production seed + local dev sample dataset.
\ir prod.sql

BEGIN;
\ir dev/001_tenant_users.sql
\ir dev/010_catalog.sql
\ir dev/020_audit_logs.sql
\ir dev/030_smtp_config.sql
\ir dev/040_pages.sql
\ir dev/050_access_tickets.sql
COMMIT;