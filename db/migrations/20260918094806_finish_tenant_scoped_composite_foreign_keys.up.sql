-- Finish what 20260902225028 began: every foreign key pointing at a
-- tenant-scoped parent names tenant_id.
--
-- The reasoning is that migration's. A single-column reference proves only that
-- the parent row exists, not that it belongs to the same tenant as the child,
-- and a tenant isolation policy checks the child's own tenant_id and nothing
-- else. Referential integrity checks are not subject to row-level security, so
-- the policy cannot see the mismatch either: a session scoped to tenant A could
-- write a row carrying A's tenant_id while pointing at a row owned by B.
--
-- The seventeen references left behind were the ones whose parent had no
-- UNIQUE (tenant_id, id) for a composite reference to name. Eight parents get
-- one here. The other two, episode_images and notifications, hold enough rows
-- that building the key would block writes, so the preceding two migrations
-- built theirs concurrently as bare unique indexes, which a reference is
-- satisfied by just as well.
--
-- ON DELETE behaviour is carried over from the constraint being replaced. Where
-- that behaviour is SET NULL, the composite constraint names the referencing
-- column, because the default would null tenant_id along with it and tenant_id
-- is NOT NULL on every one of these tables.

-- The (tenant_id, id) keys a composite reference can name. PostgreSQL accepts a
-- reference only against a unique key on exactly those columns, and each of
-- these tables has id alone as its primary key.

-- PLATFORM

-- CONSTRAINT: tenant_images tenant_images_tenant_id_id_key
ALTER TABLE ONLY tenant_images
    ADD CONSTRAINT tenant_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- CATALOG

-- CONSTRAINT: labels labels_tenant_id_id_key
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: label_images label_images_tenant_id_id_key
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: creator_images creator_images_tenant_id_id_key
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: series_images series_images_tenant_id_id_key
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- episode_images_tenant_id_id_key is 20260918094804's, and notifications'
-- is 20260918094805's.

-- PAGES

-- CONSTRAINT: pages pages_tenant_id_id_key
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: page_versions page_versions_tenant_id_id_key
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_id_id_key UNIQUE (tenant_id, id);

-- NOTIFICATIONS

-- CONSTRAINT: announcements announcements_tenant_id_id_key
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_tenant_id_id_key UNIQUE (tenant_id, id);

-- The references themselves.

-- PLATFORM

-- FK CONSTRAINT: tenant_image_variants tenant_image_variants_tenant_tenant_image_id_fkey
ALTER TABLE ONLY tenant_image_variants
    DROP CONSTRAINT tenant_image_variants_tenant_image_id_fkey;

ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_tenant_tenant_image_id_fkey FOREIGN KEY (tenant_id, tenant_image_id) REFERENCES tenant_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_themes tenant_themes_tenant_logo_image_id_fkey
ALTER TABLE ONLY tenant_themes
    DROP CONSTRAINT tenant_themes_logo_image_id_fkey;

ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_tenant_logo_image_id_fkey FOREIGN KEY (tenant_id, logo_image_id) REFERENCES tenant_images(tenant_id, id) ON DELETE SET NULL (logo_image_id);

-- FK CONSTRAINT: tenant_themes tenant_themes_tenant_icon_image_id_fkey
ALTER TABLE ONLY tenant_themes
    DROP CONSTRAINT tenant_themes_icon_image_id_fkey;

ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_tenant_icon_image_id_fkey FOREIGN KEY (tenant_id, icon_image_id) REFERENCES tenant_images(tenant_id, id) ON DELETE SET NULL (icon_image_id);

-- CATALOG

-- FK CONSTRAINT: label_images label_images_tenant_label_id_fkey
ALTER TABLE ONLY label_images
    DROP CONSTRAINT label_images_label_id_fkey;

ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_tenant_label_id_fkey FOREIGN KEY (tenant_id, label_id) REFERENCES labels(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_image_variants label_image_variants_tenant_label_image_id_fkey
ALTER TABLE ONLY label_image_variants
    DROP CONSTRAINT label_image_variants_label_image_id_fkey;

ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_tenant_label_image_id_fkey FOREIGN KEY (tenant_id, label_image_id) REFERENCES label_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: labels labels_tenant_eye_catch_image_id_fkey
ALTER TABLE ONLY labels
    DROP CONSTRAINT labels_eye_catch_image_id_fkey;

ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_tenant_eye_catch_image_id_fkey FOREIGN KEY (tenant_id, eye_catch_image_id) REFERENCES label_images(tenant_id, id) ON DELETE SET NULL (eye_catch_image_id);

-- FK CONSTRAINT: creators creators_tenant_icon_image_id_fkey
ALTER TABLE ONLY creators
    DROP CONSTRAINT creators_icon_image_id_fkey;

ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_tenant_icon_image_id_fkey FOREIGN KEY (tenant_id, icon_image_id) REFERENCES creator_images(tenant_id, id) ON DELETE SET NULL (icon_image_id);

-- FK CONSTRAINT: creator_image_variants creator_image_variants_tenant_creator_image_id_fkey
ALTER TABLE ONLY creator_image_variants
    DROP CONSTRAINT creator_image_variants_creator_image_id_fkey;

ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_tenant_creator_image_id_fkey FOREIGN KEY (tenant_id, creator_image_id) REFERENCES creator_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series series_tenant_label_id_fkey
ALTER TABLE ONLY series
    DROP CONSTRAINT series_label_id_fkey;

ALTER TABLE ONLY series
    ADD CONSTRAINT series_tenant_label_id_fkey FOREIGN KEY (tenant_id, label_id) REFERENCES labels(tenant_id, id);

-- FK CONSTRAINT: series series_tenant_eye_catch_image_id_fkey
ALTER TABLE ONLY series
    DROP CONSTRAINT series_eye_catch_image_id_fkey;

ALTER TABLE ONLY series
    ADD CONSTRAINT series_tenant_eye_catch_image_id_fkey FOREIGN KEY (tenant_id, eye_catch_image_id) REFERENCES series_images(tenant_id, id) ON DELETE SET NULL (eye_catch_image_id);

-- FK CONSTRAINT: series_image_variants series_image_variants_tenant_series_image_id_fkey
ALTER TABLE ONLY series_image_variants
    DROP CONSTRAINT series_image_variants_series_image_id_fkey;

ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_tenant_series_image_id_fkey FOREIGN KEY (tenant_id, series_image_id) REFERENCES series_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_image_variants episode_image_variants_tenant_episode_image_id_fkey
ALTER TABLE ONLY episode_image_variants
    DROP CONSTRAINT episode_image_variants_episode_image_id_fkey;

ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_tenant_episode_image_id_fkey FOREIGN KEY (tenant_id, episode_image_id) REFERENCES episode_images(tenant_id, id) ON DELETE CASCADE;

-- PAGES

-- FK CONSTRAINT: page_versions page_versions_tenant_page_id_fkey
ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_page_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_page_id_fkey FOREIGN KEY (tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: pages pages_tenant_published_version_id_fkey
ALTER TABLE ONLY pages
    DROP CONSTRAINT pages_published_version_id_fkey;

ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_published_version_id_fkey FOREIGN KEY (tenant_id, published_version_id) REFERENCES page_versions(tenant_id, id) ON DELETE SET NULL (published_version_id);

-- NOTIFICATIONS

-- FK CONSTRAINT: notification_reads notification_reads_tenant_notification_id_fkey
ALTER TABLE ONLY notification_reads
    DROP CONSTRAINT notification_reads_notification_id_fkey;

ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_tenant_notification_id_fkey FOREIGN KEY (tenant_id, notification_id) REFERENCES notifications(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcement_reads announcement_reads_tenant_announcement_id_fkey
ALTER TABLE ONLY announcement_reads
    DROP CONSTRAINT announcement_reads_announcement_id_fkey;

ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_tenant_announcement_id_fkey FOREIGN KEY (tenant_id, announcement_id) REFERENCES announcements(tenant_id, id) ON DELETE CASCADE;

-- COMMERCE

-- FK CONSTRAINT: access_tickets access_tickets_tenant_created_by_user_id_fkey
-- The staff account that granted the ticket, which is a member of the tenant
-- the ticket is filed under. 20260902225028 gave this table's user_id and
-- episode_id composite references and left this one behind.
ALTER TABLE ONLY access_tickets
    DROP CONSTRAINT access_tickets_created_by_user_id_fkey;

ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_created_by_user_id_fkey FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by_user_id);
