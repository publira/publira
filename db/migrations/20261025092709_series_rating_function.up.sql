-- FUNCTION: series_rating
-- What a series is rated, and how many readers that figure speaks for. The
-- storefront shows it on the series page and the console reports it beside the
-- series' audience, and sqlc compiles each query on its own, so the rule is
-- written here once rather than in each of them.
--
-- The rate is the reaction points the series collected over the reads its
-- episodes were finished on, which is what keeps a hundred-episode work from
-- outranking a five-episode one on volume and a widely read one from
-- outranking a beloved one. Both totals come from the series rows of
-- content_daily_stats, which already roll up every episode of the series.
--
-- The rate alone would put a series two readers finished and both reacted to at
-- the top of every list, so it is pulled towards the tenant's own mean by a
-- fixed number of imagined reads: with few reads behind it the figure is
-- mostly the tenant's, and it becomes the series' own as real reads outweigh
-- them. Twenty is roughly where a tenant's catalogue stops being the better
-- estimate of a series nobody has finished yet.
--
-- The tenant's mean comes from tenant_rating_totals rather than from a sum
-- taken here. Its inputs are every series row the tenant has for every day it
-- has ever had, and those rows are never purged, so summing them per call
-- would put a scan that grows with the tenant's whole history on every read.
-- aggregate-content-stats leaves the totals behind on the run that changes
-- them, which is the only time they move.
--
-- The result is then held to the 1-5 scale the reaction is given on. It can
-- fall below 1 on its own, because a reader who finishes an episode without
-- reacting counts in the divisor and gives no points, and a figure under the
-- bottom of the scale it is drawn on would be read as a score no reader can
-- give.
--
-- rating_count is the readers, not the divisor: a reader counts once for the
-- series however many of its episodes they reacted to. It is reported together
-- with the figure and not before it, so the two always describe the same
-- reactions — a reaction given today reaches the aggregates with the next run,
-- and a series shows nothing at all until it does: both are 0.
--
-- SECURITY INVOKER keeps the row-level security of the tables it reads the
-- caller's own, as reader_may_open_episode does.
CREATE FUNCTION series_rating(tenant_id uuid, series_id uuid)
    RETURNS TABLE (rating_count bigint, rating_average double precision)
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    WITH prior AS (
        SELECT 20::numeric AS completed_reads
    ), series_totals AS (
        SELECT
            COALESCE(sum(cds.rating_sum), 0)::numeric AS points,
            COALESCE(sum(cds.complete_count), 0)::numeric AS completed_reads
        FROM content_daily_stats cds
        WHERE cds.tenant_id = series_rating.tenant_id
            AND cds.entity_type = 'series'
            AND cds.entity_id = series_rating.series_id
    ), tenant_totals AS (
        SELECT
            COALESCE((
                SELECT trt.points
                FROM tenant_rating_totals trt
                WHERE trt.tenant_id = series_rating.tenant_id
            ), 0)::numeric AS points,
            COALESCE((
                SELECT trt.completed_reads
                FROM tenant_rating_totals trt
                WHERE trt.tenant_id = series_rating.tenant_id
            ), 0)::numeric AS completed_reads
    ), readers AS (
        SELECT COALESCE((
            SELECT src.count
            FROM series_rating_counts src
            WHERE src.tenant_id = series_rating.tenant_id
                AND src.series_id = series_rating.series_id
        ), 0)::bigint AS count
    ), rated AS (
        SELECT st.points > 0 AND r.count > 0 AS has_figure
        FROM series_totals st, readers r
    )
    SELECT
        (CASE WHEN rated.has_figure THEN r.count ELSE 0 END)::bigint,
        (CASE
            WHEN rated.has_figure THEN round(
                LEAST(
                    5::numeric,
                    GREATEST(
                        1::numeric,
                        (
                            p.completed_reads
                                * COALESCE(tt.points / NULLIF(tt.completed_reads, 0), 0::numeric)
                            + st.points
                        ) / (p.completed_reads + st.completed_reads)
                    )
                ),
                1
            )
            ELSE 0::numeric
        END)::double precision
    FROM prior p, series_totals st, tenant_totals tt, readers r, rated
$$;
