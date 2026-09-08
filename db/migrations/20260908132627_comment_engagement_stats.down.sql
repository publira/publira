-- Take the comment signal back out.
--
-- The narrowed event type check cannot accept a 'comment' row, so the rollback
-- refuses while any exists rather than deleting engagement history the up
-- never touched. Purge those events first if the rollback is really wanted.
DO $$
DECLARE
    comment_events bigint;
BEGIN
    SELECT count(*) INTO comment_events FROM content_events WHERE event_type = 'comment';
    IF comment_events > 0 THEN
        RAISE EXCEPTION
            'cannot narrow content_events_event_type_check: % comment event(s) exist',
            comment_events;
    END IF;
END
$$;

ALTER TABLE content_daily_stats
    DROP CONSTRAINT content_daily_stats_comment_count_nonneg_check;

ALTER TABLE content_daily_stats
    DROP COLUMN comment_count;

ALTER TABLE content_events
    DROP CONSTRAINT content_events_target_by_type_check;

ALTER TABLE content_events
    ADD CONSTRAINT content_events_target_by_type_check CHECK ((
        (((event_type)::text = ANY ((ARRAY['episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying])::text[])) AND (episode_id IS NOT NULL) AND (series_id IS NOT NULL))
        OR (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'favorite'::character varying])::text[])) AND (series_id IS NOT NULL) AND (episode_id IS NULL))
        OR (((event_type)::text = 'rating'::text) AND (series_id IS NOT NULL))
    ));

ALTER TABLE content_events
    DROP CONSTRAINT content_events_event_type_check;

ALTER TABLE content_events
    ADD CONSTRAINT content_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying, 'rating'::character varying, 'favorite'::character varying])::text[])));
