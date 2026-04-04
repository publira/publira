DROP INDEX IF EXISTS idx_notification_reads_user_notification;
DROP INDEX IF EXISTS idx_notifications_tenant_created_at;
DROP INDEX IF EXISTS idx_notifications_tenant_target_created_at;

DROP TABLE IF EXISTS notification_reads;
DROP TABLE IF EXISTS notifications;