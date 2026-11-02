-- FUNCTION: count_announcement_audience
-- How many readers of the connection's tenant an audience selects, for the
-- console to show before the announcement is delivered. It counts
-- announcement_audience_members, the function the worker delivers through, so
-- the number is the one delivery would reach at this moment.
--
-- SECURITY DEFINER because the console's role cannot read what the conditions
-- ask about: series_follows and episode_reads show a row only to the reader it
-- belongs to. It answers a number and never a row, and takes the tenant from
-- app.current_tenant_id alone, so a caller cannot point it at another tenant,
-- and a connection that set none counts nobody. The audience is the caller's,
-- so its shape is checked here: anything but an object counts nobody, a NULL
-- included, which announcement_audience_members would read as everyone.
-- announcement_audience_members refuses an unknown version or an empty list of
-- conditions in turn.
CREATE FUNCTION count_announcement_audience(audience jsonb) RETURNS bigint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT count(*)
    FROM public.announcement_audience_members(
        (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid,
        count_announcement_audience.audience
    ) m(user_id)
    WHERE jsonb_typeof(count_announcement_audience.audience) = 'object'
$$;
