ALTER TABLE announcements
    ADD COLUMN target_user_id uuid;

ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_tenant_target_user_id_fkey FOREIGN KEY (tenant_id, target_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

CREATE INDEX idx_announcements_tenant_target_created_at ON announcements USING btree (tenant_id, target_user_id, created_at DESC, id DESC);
