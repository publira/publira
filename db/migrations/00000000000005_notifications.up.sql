-- Notifications: Personal in-app notifications and tenant-wide announcements, with their
-- per-user read state.

-- TABLE: notifications
-- Personal in-app events for tenant members and tenant admins. Display copy
-- is derived from notification_type + payload; there is no title/body column.
CREATE TABLE notifications (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    notification_type character varying(64) NOT NULL,
    subject_key character varying(255) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT notifications_subject_key_check CHECK ((char_length((subject_key)::text) > 0))
);

-- CONSTRAINT: notifications notifications_pkey
ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

-- CONSTRAINT: notifications notifications_user_id_notification_type_subject_key_key
-- One row per recipient / type / subject so workers can retry inserts.
ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_user_id_notification_type_subject_key_key UNIQUE (user_id, notification_type, subject_key);

-- FK CONSTRAINT: notifications notifications_tenant_id_fkey
ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: notifications notifications_user_id_fkey
ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_notifications_user_created_at
-- Trailing id is the ListNotifications cursor tie-breaker. btree scans
-- backwards, so this one index covers both page directions.
CREATE INDEX idx_notifications_user_created_at ON notifications USING btree (user_id, created_at DESC, id DESC);

-- INDEX: idx_notifications_tenant_user_created_at
CREATE INDEX idx_notifications_tenant_user_created_at ON notifications USING btree (tenant_id, user_id, created_at DESC, id DESC);

-- ROW SECURITY: notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- POLICY: notifications notifications_tenant_isolation
CREATE POLICY notifications_tenant_isolation ON notifications USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: notification_reads
CREATE TABLE notification_reads (
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: notification_reads notification_reads_pkey
ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (notification_id, user_id);

-- FK CONSTRAINT: notification_reads notification_reads_notification_id_fkey
ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE;

-- FK CONSTRAINT: notification_reads notification_reads_tenant_id_fkey
ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: notification_reads notification_reads_user_id_fkey
ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_notification_reads_user_notification
CREATE INDEX idx_notification_reads_user_notification ON notification_reads USING btree (user_id, notification_id);

-- ROW SECURITY: notification_reads
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

-- POLICY: notification_reads notification_reads_tenant_isolation
CREATE POLICY notification_reads_tenant_isolation ON notification_reads USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: announcements
CREATE TABLE announcements (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid,
    announcement_type character varying(64) NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: announcements announcements_pkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: announcements announcements_target_user_id_fkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcements announcements_tenant_id_fkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_announcements_tenant_created_at
CREATE INDEX idx_announcements_tenant_created_at ON announcements USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_announcements_tenant_target_created_at
CREATE INDEX idx_announcements_tenant_target_created_at ON announcements USING btree (tenant_id, target_user_id, created_at DESC, id DESC);

-- TABLE: announcement_reads
CREATE TABLE announcement_reads (
    announcement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: announcement_reads announcement_reads_pkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY (announcement_id, user_id);

-- FK CONSTRAINT: announcement_reads announcement_reads_announcement_id_fkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcement_reads announcement_reads_user_id_fkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_announcement_reads_user_announcement
CREATE INDEX idx_announcement_reads_user_announcement ON announcement_reads USING btree (user_id, announcement_id);
