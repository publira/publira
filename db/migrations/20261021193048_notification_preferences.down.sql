-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY notifications
    DROP COLUMN in_inbox,
    DROP COLUMN category;

ALTER TABLE ONLY user_notification_settings
    DROP COLUMN announcements_inbox_enabled,
    DROP COLUMN comments_inbox_enabled,
    DROP COLUMN followed_creators_mobile_push_enabled,
    DROP COLUMN followed_creators_web_push_enabled,
    DROP COLUMN followed_creators_inbox_enabled,
    DROP COLUMN followed_episodes_mobile_push_enabled,
    DROP COLUMN followed_episodes_web_push_enabled,
    DROP COLUMN followed_episodes_inbox_enabled;
