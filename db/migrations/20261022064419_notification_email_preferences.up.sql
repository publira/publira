-- The email column of a reader's notification preferences, one cell per
-- category the server mails, and the record of which notifications were mailed.
--
-- A constant default adds a column without rewriting the table.

-- COLUMN: user_notification_settings followed_episodes_email_enabled
-- COLUMN: user_notification_settings followed_creators_email_enabled
-- COLUMN: user_notification_settings comments_email_enabled
-- COLUMN: user_notification_settings announcements_email_enabled
ALTER TABLE ONLY user_notification_settings
    ADD COLUMN followed_episodes_email_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_creators_email_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN comments_email_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN announcements_email_enabled boolean DEFAULT true NOT NULL;

-- A reader who turned email notifications off asked for no notification mail,
-- so every email cell starts off for them. email_notifications_enabled is read
-- by nothing from here on: what the API still answers under that name is
-- derived from these cells.
UPDATE user_notification_settings
SET followed_episodes_email_enabled = false,
    followed_creators_email_enabled = false,
    comments_email_enabled = false,
    announcements_email_enabled = false
WHERE NOT email_notifications_enabled;

-- COLUMN: notifications emailed_at
-- When the row's recipient was mailed about it. The mail goes out a recipient
-- at a time from the rows, and a retry of the event mails only the rows this
-- is still empty on, so nobody receives the same notification twice.
ALTER TABLE ONLY notifications
    ADD COLUMN emailed_at timestamp with time zone;
