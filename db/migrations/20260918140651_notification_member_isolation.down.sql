DROP POLICY notification_reads_member_isolation ON notification_reads;

CREATE POLICY notification_reads_tenant_isolation ON notification_reads USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

DROP POLICY notifications_tenant_delivery ON notifications;

DROP POLICY notifications_member_isolation ON notifications;

CREATE POLICY notifications_tenant_isolation ON notifications USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
