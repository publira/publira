-- COLUMN: tenant_admin_invitations role
-- The console role the invitation grants when it is accepted. Every invitation
-- made before the column existed granted tenant_admin, which is what the
-- default fills in for them.
ALTER TABLE tenant_admin_invitations
    ADD COLUMN role character varying(32) DEFAULT 'tenant_admin'::character varying NOT NULL;

-- CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_role_check
ALTER TABLE tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_role_check CHECK (((role)::text = ANY ((ARRAY['tenant_admin'::character varying, 'tenant_editor'::character varying, 'tenant_auditor'::character varying])::text[])));
