-- FUNCTION: notification_in_inbox
-- Whether a notification filed for a reader under a category is listed in
-- their inbox: unless that category's inbox cell is off. A reader who saved
-- nothing holds every cell on, and the staff, everyone, and account
-- categories have no cell. Every insert that files a reader's row asks it, the
-- single-row insert and the one that files a page of recipients alike, so the
-- cells are named once.
--
-- SECURITY INVOKER keeps user_notification_settings behind the caller's own
-- row-level security. The settings are isolated to the reader they belong to,
-- so only a connection that sees every reader's, such as the worker's, gets
-- an answer other than true.
CREATE FUNCTION notification_in_inbox(tenant_id uuid, user_id uuid, category text) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT COALESCE((
        SELECT CASE notification_in_inbox.category
            WHEN 'followed_episodes' THEN s.followed_episodes_inbox_enabled
            WHEN 'followed_creators' THEN s.followed_creators_inbox_enabled
            WHEN 'comments' THEN s.comments_inbox_enabled
            WHEN 'announcements' THEN s.announcements_inbox_enabled
        END
        FROM user_notification_settings s
        WHERE s.tenant_id = notification_in_inbox.tenant_id
            AND s.user_id = notification_in_inbox.user_id
    ), true)
$$;
