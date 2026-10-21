-- Whether an announcement answers to its readers' notification preferences.
--
-- The CHECK constraints are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE locks without scanning either table; the next migration validates
-- them under a lock that lets reads and writes continue.

-- COLUMN: announcements delivery
-- 'preferred' reaches the readers whose announcements cell is on, and
-- 'everyone' every reader whatever that cell says, for the notice a reader must
-- not miss — a change of terms, an outage — on a channel that otherwise carries
-- campaign news. The default is 'preferred' because that is what every
-- announcement already posted was delivered as.
ALTER TABLE ONLY announcements
    ADD COLUMN delivery text DEFAULT 'preferred'::text NOT NULL,
    ADD CONSTRAINT announcements_delivery_check CHECK ((delivery = ANY (ARRAY['preferred'::text, 'everyone'::text]))) NOT VALID;

-- COLUMN: notifications category
-- 'everyone' joins the categories: an announcement addressed to every reader,
-- which no preference governs, so each channel a cell would gate lets it
-- through without a cell of its own.
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'everyone'::text, 'staff'::text]))) NOT VALID;
