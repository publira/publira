\set ON_ERROR_STOP on

-- Production seed: DB users and roles only.
-- Does NOT include application data (tenants, accounts, etc.).
\ir baseline/000_rls_bypass_role.sql
