-- The development passwords of the login roles baseline/000_rls_bypass_role.sql
-- creates without one. Every local URL and the Dev Container's defaults connect
-- with these.
ALTER ROLE publira_platform PASSWORD 'platformpass';
ALTER ROLE publira_content_stats PASSWORD 'contentstatspass';
ALTER ROLE publira_outbox PASSWORD 'outboxpass';
ALTER ROLE publira_ticker PASSWORD 'tickerpass';
ALTER ROLE publira_admin PASSWORD 'adminpass';
ALTER ROLE publira_public PASSWORD 'publicpass';
