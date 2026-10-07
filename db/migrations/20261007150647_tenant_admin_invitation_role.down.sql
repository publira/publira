ALTER TABLE tenant_admin_invitations
    DROP CONSTRAINT IF EXISTS tenant_admin_invitations_role_check;

ALTER TABLE tenant_admin_invitations
    DROP COLUMN IF EXISTS role;
