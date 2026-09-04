-- Restore the buyer as a required, RESTRICT-ed reference.
--
-- A purchase whose buyer was already anonymized names a reader the up cannot
-- bring back, so the rollback refuses rather than deleting the commerce record
-- the up exists to preserve. Reattach or archive those rows first.
DO $$
DECLARE
    anonymized bigint;
BEGIN
    SELECT count(*) INTO anonymized FROM purchases WHERE user_id IS NULL;
    IF anonymized > 0 THEN
        RAISE EXCEPTION
            'cannot restore purchases.user_id NOT NULL: % purchase(s) have an anonymized buyer',
            anonymized;
    END IF;
END
$$;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_user_id_fkey;

ALTER TABLE purchases
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT;
