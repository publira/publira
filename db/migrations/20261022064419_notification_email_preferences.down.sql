ALTER TABLE ONLY notifications
    DROP COLUMN emailed_at;

ALTER TABLE ONLY user_notification_settings
    DROP COLUMN announcements_email_enabled,
    DROP COLUMN comments_email_enabled,
    DROP COLUMN followed_creators_email_enabled,
    DROP COLUMN followed_episodes_email_enabled;
