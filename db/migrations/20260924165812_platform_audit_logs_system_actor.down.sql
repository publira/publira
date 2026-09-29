-- Restore the operator as a required reference.
--
-- An entry a command wrote names no operator, so the rollback refuses rather
-- than deleting the audit rows the up exists to allow. Export or reassign those
-- entries first.
DO $$
DECLARE
    system_entries bigint;
BEGIN
    SELECT count(*) INTO system_entries FROM platform_audit_logs WHERE actor_platform_user_id IS NULL;
    IF system_entries > 0 THEN
        RAISE EXCEPTION
            'cannot restore platform_audit_logs.actor_platform_user_id NOT NULL: % entry/entries have no operator',
            system_entries;
    END IF;
END
$$;

ALTER TABLE platform_audit_logs
    DROP CONSTRAINT platform_audit_logs_actor_platform_user_id_check;

ALTER TABLE platform_audit_logs
    ALTER COLUMN actor_platform_user_id SET NOT NULL;
