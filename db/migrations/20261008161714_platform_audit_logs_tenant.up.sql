-- The tenant a platform audit entry is about, kept on the entry itself.

-- COLUMN: platform_audit_logs tenant_id
-- Written with the entry rather than derived from its target on every read: a
-- reader the platform deletes takes its users row with it, and an entry that
-- found its tenant through that row would drop out of the tenant's log, the
-- user_deleted entry itself included.
--
-- No foreign key, like target_id: the log outlives what it names, and a key
-- would either refuse to delete a tenant that has entries or erase the record
-- of what was done to it. NULL is an entry about no tenant, such as a
-- platform setting or an operator.
ALTER TABLE platform_audit_logs
    ADD COLUMN tenant_id uuid;

-- The entries already stored take the tenant their target still names. One
-- whose target is already gone stays NULL: nothing left says which tenant it
-- was for.
UPDATE platform_audit_logs a
SET tenant_id = CASE a.target_type
        WHEN 'tenant' THEN (SELECT t.id FROM tenants t WHERE t.id::text = a.target_id)
        WHEN 'tenant_admin_invitation' THEN (SELECT i.tenant_id FROM tenant_admin_invitations i WHERE i.id::text = a.target_id)
        WHEN 'user' THEN (SELECT u.tenant_id FROM users u WHERE u.id::text = a.target_id)
    END
WHERE a.target_type IN ('tenant', 'tenant_admin_invitation', 'user');
