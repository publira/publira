-- Say whether a series is still running, when a new episode is expected, and
-- who it is meant for.
--
-- The three columns are NOT NULL with a default because every series answers
-- all three: one nobody has edited is a running, all-ages series on no fixed
-- weekday, which is what the defaults state.
--
-- schedule_weekdays holds the weekdays a new episode is expected, as
-- EXTRACT(DOW) numbers: 0 is Sunday and 6 is Saturday. An empty array is an
-- irregular schedule, not an unknown one. The CHECK constrains the range only;
-- ordering the days and dropping duplicates is the writer's job, because a
-- CHECK cannot hold the subquery that would compare the array against its own
-- distinct elements.
ALTER TABLE ONLY series_listings
    ADD COLUMN status character varying(16) DEFAULT 'ongoing' NOT NULL,
    ADD COLUMN schedule_weekdays smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    ADD COLUMN age_rating character varying(8) DEFAULT 'all' NOT NULL,
    ADD CONSTRAINT series_listings_status_check CHECK (((status)::text = ANY ((ARRAY['ongoing'::character varying, 'completed'::character varying, 'hiatus'::character varying])::text[]))),
    ADD CONSTRAINT series_listings_schedule_weekdays_check CHECK ((schedule_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[])),
    ADD CONSTRAINT series_listings_age_rating_check CHECK (((age_rating)::text = ANY ((ARRAY['all'::character varying, 'r15'::character varying, 'r18'::character varying])::text[])));
