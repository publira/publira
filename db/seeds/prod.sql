\set ON_ERROR_STOP on

-- Production seed: DB users, roles, and the ownership they need.
-- Does NOT include application data (tenants, accounts, etc.).
\ir baseline/000_rls_bypass_role.sql
\ir baseline/010_river_object_owner.sql
