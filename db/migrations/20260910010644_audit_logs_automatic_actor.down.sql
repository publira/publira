-- Restore the actor as a required reference.
--
-- An entry the platform wrote by itself names no account, so the rollback
-- refuses rather than deleting the audit rows the up exists to allow. Export
-- or reassign those entries first.
DO $$
DECLARE
    automatic bigint;
BEGIN
    SELECT count(*) INTO automatic FROM audit_logs WHERE actor_user_id IS NULL;
    IF automatic > 0 THEN
        RAISE EXCEPTION
            'cannot restore audit_logs.actor_user_id NOT NULL: % entry/entries have no actor',
            automatic;
    END IF;
END
$$;

ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_check;

ALTER TABLE audit_logs
    ALTER COLUMN actor_user_id SET NOT NULL;
