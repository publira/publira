-- COLUMN: webhook_deliveries reader_id
-- The reader a delivery's payload names — the buyer, the subscriber, the
-- reader who signed up, the writer of a comment, the sender of a contact
-- message — or NULL for an event about no reader. The payload carries their
-- address, their display name, or what they wrote, so a delivery goes with the
-- account when it is deleted, through the foreign key below, whichever path
-- deletes it. The previous release writes no reader, which leaves its
-- deliveries to the purge.
ALTER TABLE ONLY webhook_deliveries
    ADD COLUMN reader_id uuid;

-- FK CONSTRAINT: webhook_deliveries webhook_deliveries_tenant_reader_id_fkey
-- NOT VALID so this file takes its lock without scanning the table; the next
-- migration validates it under a lock that lets reads and writes continue.
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_reader_id_fkey FOREIGN KEY (tenant_id, reader_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE NOT VALID;
