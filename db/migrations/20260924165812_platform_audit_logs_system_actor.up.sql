-- A platform audit entry with no operator behind it.

-- COLUMN: platform_audit_logs actor_platform_user_id
-- Nullable, for a change made from publiractl: the command has no session and
-- authenticates only as the PostgreSQL role it connects with, so there is no
-- operator to name, and an install that runs no Platform Console has none at
-- all.
--
-- actor_role carries what did act instead, 'system', as audit_logs does for
-- the changes the platform makes on a tenant's standing instruction.
ALTER TABLE platform_audit_logs
    ALTER COLUMN actor_platform_user_id DROP NOT NULL;

-- CONSTRAINT: platform_audit_logs platform_audit_logs_actor_platform_user_id_check
-- The two halves of an actor agree: an entry with no operator names 'system',
-- and one that names an operator role has the operator who held it.
ALTER TABLE platform_audit_logs
    ADD CONSTRAINT platform_audit_logs_actor_platform_user_id_check CHECK (((actor_platform_user_id IS NULL) = ((actor_role)::text = 'system'::text)));
