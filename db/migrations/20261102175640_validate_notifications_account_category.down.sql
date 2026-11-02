-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'everyone'::text, 'staff'::text, 'account'::text]))) NOT VALID;
