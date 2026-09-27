-- An announcement is addressed to everyone who opens the tenant's site, so the
-- column that named a single recipient goes, with the foreign key and the index
-- built on it. A row that had one stays, as an announcement to the tenant.
DROP INDEX idx_announcements_tenant_target_created_at;

ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_tenant_target_user_id_fkey;

ALTER TABLE announcements
    DROP COLUMN target_user_id;
