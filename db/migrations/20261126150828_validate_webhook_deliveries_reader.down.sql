-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY webhook_deliveries
    DROP CONSTRAINT webhook_deliveries_tenant_reader_id_fkey,
    ADD CONSTRAINT webhook_deliveries_tenant_reader_id_fkey FOREIGN KEY (tenant_id, reader_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE NOT VALID;
