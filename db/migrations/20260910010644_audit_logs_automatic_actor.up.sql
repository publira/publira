-- An audit entry the platform wrote by itself, with no account behind it.

-- COLUMN: audit_logs actor_user_id
-- Nullable, for an action no member of the tenant performed: the report
-- threshold hiding a comment is the tenant's own policy running, and naming
-- the reader whose report happened to reach it would file the removal under an
-- account that only ever pressed "report".
--
-- actor_role carries what did act instead, so an entry with no actor is still
-- attributable: 'system' beside the tenant_admin and tenant_editor the console
-- writes. The composite foreign key stays as it is — a null actor references
-- no user, and a named one is still a member of the tenant the entry is filed
-- under.
ALTER TABLE audit_logs
    ALTER COLUMN actor_user_id DROP NOT NULL;

-- CONSTRAINT: audit_logs audit_logs_actor_user_id_check
-- The two halves of an actor agree: an entry with no account names 'system',
-- and one that names a role of the console has the account that held it.
-- Without this a handler that forgot the actor would file a member's action as
-- the platform's own.
ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK (((actor_user_id IS NULL) = ((actor_role)::text = 'system'::text)));
