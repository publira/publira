-- Restore the single-column foreign keys, in the reverse order of the up, then
-- take away the keys they no longer name. The two indexes the preceding
-- migrations built concurrently are not among them — they are those
-- migrations' to drop, concurrently, the way they were built.

-- COMMERCE

ALTER TABLE ONLY access_tickets
    DROP CONSTRAINT access_tickets_tenant_created_by_user_id_fkey;

ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- NOTIFICATIONS

ALTER TABLE ONLY announcement_reads
    DROP CONSTRAINT announcement_reads_tenant_announcement_id_fkey;

ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;

ALTER TABLE ONLY notification_reads
    DROP CONSTRAINT notification_reads_tenant_notification_id_fkey;

ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE;

-- PAGES

ALTER TABLE ONLY pages
    DROP CONSTRAINT pages_tenant_published_version_id_fkey;

ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_published_version_id_fkey FOREIGN KEY (published_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;

ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_page_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_fkey FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE;

-- CATALOG

ALTER TABLE ONLY episode_image_variants
    DROP CONSTRAINT episode_image_variants_tenant_episode_image_id_fkey;

ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_episode_image_id_fkey FOREIGN KEY (episode_image_id) REFERENCES episode_images(id) ON DELETE CASCADE;

ALTER TABLE ONLY series_image_variants
    DROP CONSTRAINT series_image_variants_tenant_series_image_id_fkey;

ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_series_image_id_fkey FOREIGN KEY (series_image_id) REFERENCES series_images(id) ON DELETE CASCADE;

ALTER TABLE ONLY series
    DROP CONSTRAINT series_tenant_eye_catch_image_id_fkey;

ALTER TABLE ONLY series
    ADD CONSTRAINT series_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES series_images(id) ON DELETE SET NULL;

ALTER TABLE ONLY series
    DROP CONSTRAINT series_tenant_label_id_fkey;

ALTER TABLE ONLY series
    ADD CONSTRAINT series_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id);

ALTER TABLE ONLY creator_image_variants
    DROP CONSTRAINT creator_image_variants_tenant_creator_image_id_fkey;

ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_creator_image_id_fkey FOREIGN KEY (creator_image_id) REFERENCES creator_images(id) ON DELETE CASCADE;

ALTER TABLE ONLY creators
    DROP CONSTRAINT creators_tenant_icon_image_id_fkey;

ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_icon_image_id_fkey FOREIGN KEY (icon_image_id) REFERENCES creator_images(id) ON DELETE SET NULL;

ALTER TABLE ONLY labels
    DROP CONSTRAINT labels_tenant_eye_catch_image_id_fkey;

ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES label_images(id) ON DELETE SET NULL;

ALTER TABLE ONLY label_image_variants
    DROP CONSTRAINT label_image_variants_tenant_label_image_id_fkey;

ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_label_image_id_fkey FOREIGN KEY (label_image_id) REFERENCES label_images(id) ON DELETE CASCADE;

ALTER TABLE ONLY label_images
    DROP CONSTRAINT label_images_tenant_label_id_fkey;

ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE;

-- PLATFORM

ALTER TABLE ONLY tenant_themes
    DROP CONSTRAINT tenant_themes_tenant_icon_image_id_fkey;

ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_icon_image_id_fkey FOREIGN KEY (icon_image_id) REFERENCES tenant_images(id) ON DELETE SET NULL;

ALTER TABLE ONLY tenant_themes
    DROP CONSTRAINT tenant_themes_tenant_logo_image_id_fkey;

ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_logo_image_id_fkey FOREIGN KEY (logo_image_id) REFERENCES tenant_images(id) ON DELETE SET NULL;

ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_tenant_tenant_image_id_fkey;

ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_tenant_image_id_fkey FOREIGN KEY (tenant_image_id) REFERENCES tenant_images(id) ON DELETE CASCADE;

-- The (tenant_id, id) keys.

-- NOTIFICATIONS

ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_tenant_id_id_key;

-- PAGES

ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_id_id_key;

ALTER TABLE ONLY pages
    DROP CONSTRAINT pages_tenant_id_id_key;

-- CATALOG

ALTER TABLE ONLY series_images
    DROP CONSTRAINT series_images_tenant_id_id_key;

ALTER TABLE ONLY creator_images
    DROP CONSTRAINT creator_images_tenant_id_id_key;

ALTER TABLE ONLY label_images
    DROP CONSTRAINT label_images_tenant_id_id_key;

ALTER TABLE ONLY labels
    DROP CONSTRAINT labels_tenant_id_id_key;

-- PLATFORM

ALTER TABLE ONLY tenant_images
    DROP CONSTRAINT tenant_images_tenant_id_id_key;
