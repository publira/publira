-- Which way a work's pages are turned, and the page from which two of them
-- share a screen.

-- COLUMN: series_listings reading_direction, spread_start_index
-- The values every episode of the series is laid out with. The defaults are
-- the layout both viewers used before either value existed — turned right to
-- left, with the cover standing alone and pairing from the page after it — so
-- no series already in a catalog changes appearance.
--
-- spread_start_index is a zero-based page index. A series has no pages of its
-- own, so it is bounded below only; an episode shorter than the index is laid
-- out without a spread.
ALTER TABLE ONLY series_listings
    ADD COLUMN reading_direction text DEFAULT 'rtl'::text NOT NULL,
    ADD COLUMN spread_start_index integer DEFAULT 1 NOT NULL,
    ADD CONSTRAINT series_listings_reading_direction_check CHECK ((reading_direction = ANY (ARRAY['rtl'::text, 'ltr'::text]))),
    ADD CONSTRAINT series_listings_spread_start_index_check CHECK ((spread_start_index >= 0));

-- COLUMN: episodes reading_direction, spread_start_index
-- One episode's override of each, and NULL where it follows its series. It is
-- nullable rather than a copy of the series value so that a change to the
-- series reaches every episode that states nothing of its own.
--
-- The columns sit on episodes rather than episode_listings because they
-- describe the body's pages, which hang off episodes, and the listing row is
-- rewritten whole on every schedule save. Whether an index lies within the
-- episode's pages depends on its images, which a CHECK cannot see, so the API
-- enforces that bound.
ALTER TABLE ONLY episodes
    ADD COLUMN reading_direction text,
    ADD COLUMN spread_start_index integer,
    ADD CONSTRAINT episodes_reading_direction_check CHECK ((reading_direction = ANY (ARRAY['rtl'::text, 'ltr'::text]))),
    ADD CONSTRAINT episodes_spread_start_index_check CHECK ((spread_start_index >= 0));
