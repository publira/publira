ALTER TABLE ONLY webhook_deliveries
    DROP CONSTRAINT IF EXISTS webhook_deliveries_tenant_reader_id_fkey;

ALTER TABLE ONLY webhook_deliveries
    DROP COLUMN IF EXISTS reader_id;
