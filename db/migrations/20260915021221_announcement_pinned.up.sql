-- A pinned announcement is the one the site shows as a banner above every page.
-- pinned_until bounds that banner so a notice does not outlive its own event; a
-- NULL leaves it up until the console takes it down. Clearing pinned is what
-- stops the banner, and it keeps pinned_until as the instant that stopped it.
ALTER TABLE announcements
    ADD COLUMN pinned boolean DEFAULT false NOT NULL,
    ADD COLUMN pinned_until timestamp with time zone;
