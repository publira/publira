-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'everyone'::text, 'staff'::text]))) NOT VALID;

ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_delivery_check,
    ADD CONSTRAINT announcements_delivery_check CHECK ((delivery = ANY (ARRAY['preferred'::text, 'everyone'::text]))) NOT VALID;
