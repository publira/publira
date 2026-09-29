-- Make commenting an engagement signal the ranking and recommendation builds
-- can see.
--
-- A comment is filed in content_events like every other reader action, and
-- counted per day in content_daily_stats like every other engagement total.
-- The two answer different questions on purpose: the event is the reader's
-- own history, which is what the per-user feature build reads, and the daily
-- count is the item's, which is what the ranking reads.

-- CONSTRAINT: content_events content_events_event_type_check
-- 'comment' joins the accepted event types.
ALTER TABLE content_events
    DROP CONSTRAINT content_events_event_type_check;

ALTER TABLE content_events
    ADD CONSTRAINT content_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying, 'rating'::character varying, 'favorite'::character varying, 'comment'::character varying])::text[])));

-- CONSTRAINT: content_events content_events_target_by_type_check
-- A comment answers one episode, so it targets an episode and the series that
-- episode belongs to, like a completion or a purchase.
ALTER TABLE content_events
    DROP CONSTRAINT content_events_target_by_type_check;

ALTER TABLE content_events
    ADD CONSTRAINT content_events_target_by_type_check CHECK ((
        (((event_type)::text = ANY ((ARRAY['episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying, 'comment'::character varying])::text[])) AND (episode_id IS NOT NULL) AND (series_id IS NOT NULL))
        OR (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'favorite'::character varying])::text[])) AND (series_id IS NOT NULL) AND (episode_id IS NULL))
        OR (((event_type)::text = 'rating'::text) AND (series_id IS NOT NULL))
    ));

-- COLUMN: content_daily_stats comment_count
-- The comments that became public on that day, counted from episode_comments
-- rather than from the events above, for the same reason purchase_count is
-- counted from purchases: the table that owns the fact is the one that still
-- knows the comment has since been removed. A comment hidden by staff or
-- withdrawn by its author therefore leaves this count from the next rebuild
-- on, while the row already written for a past day keeps what that day was.
--
-- Its own CHECK rather than a wider content_daily_stats_nonneg_check: the
-- migrations here are append-only, and rewriting that constraint to name one
-- more column would revalidate every existing row to say nothing new.
ALTER TABLE content_daily_stats
    ADD COLUMN comment_count bigint DEFAULT 0 NOT NULL;

ALTER TABLE content_daily_stats
    ADD CONSTRAINT content_daily_stats_comment_count_nonneg_check CHECK ((comment_count >= 0));
