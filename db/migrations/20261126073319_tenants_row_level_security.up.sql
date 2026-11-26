-- tenants is read by every role, the storefront and the tenant console
-- included: a request is resolved to its tenant from its host before any
-- tenant is set on the connection. So the permissive policy here lets every
-- role see and write every row, as the table did without row-level security,
-- and the grants in db/seeds/baseline decide what each role may do to it.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_visible ON tenants
    AS PERMISSIVE
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- The tenant console writes its own tenant's time zone and languages, and the
-- storefront locks its own tenant's row; neither touches another tenant's.
-- This policy confines both to the row of the tenant set on the connection,
-- for an UPDATE and for a SELECT that locks rows, which PostgreSQL holds to
-- the UPDATE policies too. It names the roles by current_user rather than
-- with TO, because the migrations run before the roles exist on a new
-- install. Every other role works across tenants and is left as it was.
CREATE POLICY tenants_own_row ON tenants
    AS RESTRICTIVE
    FOR UPDATE
    USING (
        (CURRENT_USER <> ALL (ARRAY['publira_admin'::name, 'publira_public'::name]))
        OR (id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (CURRENT_USER <> ALL (ARRAY['publira_admin'::name, 'publira_public'::name]))
        OR (id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
    );
