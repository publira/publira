-- notifications and notification_reads are one reader's own bell, so tenant
-- isolation alone let one member of a tenant read and rewrite another's. Both
-- take the member isolation the other reader-owned tables carry.
DROP POLICY notifications_tenant_isolation ON notifications;

-- POLICY: notifications notifications_member_isolation
CREATE POLICY notifications_member_isolation ON notifications
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- POLICY: notifications notifications_tenant_delivery
-- A bell row is filed for its recipient by somebody else — the admin who
-- approves or hides a comment, the reader whose report hides one — on that
-- caller's own connection, so an insert only has to stay inside the tenant.
-- Policies of one command are OR'ed, which leaves reading, updating, and
-- deleting to the member policy alone.
CREATE POLICY notifications_tenant_delivery ON notifications
    FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

DROP POLICY notification_reads_tenant_isolation ON notification_reads;

-- POLICY: notification_reads notification_reads_member_isolation
CREATE POLICY notification_reads_member_isolation ON notification_reads
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );
