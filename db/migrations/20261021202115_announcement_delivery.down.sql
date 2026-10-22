-- A row filed for everyone goes back to the category its type had before, so
-- the narrower constraint holds again. Its in_inbox is kept: the reader was
-- shown it, and taking it out of their inbox now would rewrite what they read.
UPDATE notifications
SET category = 'announcements'
WHERE category = 'everyone';

ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'staff'::text])));

-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY announcements
    DROP COLUMN delivery;
