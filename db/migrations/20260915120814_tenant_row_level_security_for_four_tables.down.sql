DROP POLICY episode_image_variants_tenant_isolation ON episode_image_variants;

ALTER TABLE episode_image_variants DISABLE ROW LEVEL SECURITY;

DROP INDEX idx_episode_image_variants_tenant_id;

ALTER TABLE ONLY episode_image_variants
    DROP CONSTRAINT episode_image_variants_tenant_id_fkey;

ALTER TABLE episode_image_variants
    DROP COLUMN tenant_id;

DROP POLICY user_notification_settings_member_isolation ON user_notification_settings;

ALTER TABLE user_notification_settings DISABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY user_notification_settings
    DROP CONSTRAINT user_notification_settings_tenant_user_id_fkey;

ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_notification_settings
    DROP COLUMN tenant_id;

DROP POLICY announcement_reads_member_isolation ON announcement_reads;

ALTER TABLE announcement_reads DISABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY announcement_reads
    DROP CONSTRAINT announcement_reads_tenant_user_id_fkey;

ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE announcement_reads
    DROP COLUMN tenant_id;

DROP POLICY announcements_tenant_isolation ON announcements;

ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;
