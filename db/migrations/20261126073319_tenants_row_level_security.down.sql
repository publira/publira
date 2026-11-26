DROP POLICY IF EXISTS publira_rls_bypass ON tenants;
DROP POLICY tenants_own_row ON tenants;
DROP POLICY tenants_visible ON tenants;
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
