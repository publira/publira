-- The announcement push cells. They default off, so a reader who has not asked
-- for an announcement push receives none, including when the announcement was
-- sent to everyone. A constant default adds the columns without rewriting the
-- table.

-- COLUMN: user_notification_settings announcements_web_push_enabled
-- COLUMN: user_notification_settings announcements_mobile_push_enabled
ALTER TABLE ONLY user_notification_settings
    ADD COLUMN announcements_web_push_enabled boolean DEFAULT false NOT NULL,
    ADD COLUMN announcements_mobile_push_enabled boolean DEFAULT false NOT NULL;
