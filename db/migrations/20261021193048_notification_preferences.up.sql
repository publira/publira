-- A reader's notification preferences, one cell per category and channel the
-- server delivers. Each cell is a column named <category>_<channel>_enabled and
-- defaults to on, so a reader who has saved nothing is notified everywhere, as
-- every reader was before the cells existed. A category the server does not
-- push gets no push cell until the push allowlist admits its type.
--
-- A constant default adds a column without rewriting the table.

-- COLUMN: user_notification_settings followed_episodes_inbox_enabled
-- COLUMN: user_notification_settings followed_episodes_web_push_enabled
-- COLUMN: user_notification_settings followed_episodes_mobile_push_enabled
-- COLUMN: user_notification_settings followed_creators_inbox_enabled
-- COLUMN: user_notification_settings followed_creators_web_push_enabled
-- COLUMN: user_notification_settings followed_creators_mobile_push_enabled
-- COLUMN: user_notification_settings comments_inbox_enabled
-- COLUMN: user_notification_settings announcements_inbox_enabled
ALTER TABLE ONLY user_notification_settings
    ADD COLUMN followed_episodes_inbox_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_episodes_web_push_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_episodes_mobile_push_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_creators_inbox_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_creators_web_push_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN followed_creators_mobile_push_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN comments_inbox_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN announcements_inbox_enabled boolean DEFAULT true NOT NULL;

-- COLUMN: notifications category
-- Which of the recipient's preferences a row answers to: the follow that earned
-- an episode, the reader's own comment, the tenant's announcement, or the
-- recipient being one of the tenant's staff, which no preference governs.
--
-- COLUMN: notifications in_inbox
-- Whether the row is listed in the recipient's inbox. A row whose inbox cell is
-- off is still written rather than left out, because the push that mirrors it
-- resolves its devices from the row.
ALTER TABLE ONLY notifications
    ADD COLUMN category text,
    ADD COLUMN in_inbox boolean DEFAULT true NOT NULL;

-- Every row filed so far stays listed, as it already was. Its category only
-- decides which devices a push still owed for it reaches, and an
-- episode_published row is taken to have been earned by the episode or its
-- series.
UPDATE notifications
SET category = CASE notification_type
    WHEN 'episode_published' THEN 'followed_episodes'
    WHEN 'comment_approved' THEN 'comments'
    WHEN 'announcement_posted' THEN 'announcements'
    ELSE 'staff'
END;

ALTER TABLE ONLY notifications
    ALTER COLUMN category SET NOT NULL,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'staff'::text])));
