-- FUNCTION: count_announcement_deliveries
-- How many readers of the connection's tenant an announcement's notification
-- was written for, for the console's list. The fan-out writes one
-- notifications row per reader under the announcement's subject key, so the
-- rows are the record and nothing has to keep a tally in step with them.
--
-- SECURITY DEFINER because the console's role cannot read the rows it counts:
-- notifications show a row only to the reader it belongs to. It answers a
-- number and never a row, and takes the tenant from app.current_tenant_id
-- alone, so an announcement of another tenant, and any announcement on a
-- connection that set no tenant, counts nobody.
CREATE FUNCTION count_announcement_deliveries(announcement_id uuid) RETURNS bigint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT count(*)
    FROM public.notifications n
    WHERE n.tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid
        AND n.notification_type = 'announcement_posted'
        AND n.subject_key = 'announcement:' || count_announcement_deliveries.announcement_id::text
$$;

-- FUNCTION: count_announcement_opens
-- How many readers of the connection's tenant opened an announcement: its
-- announcement_reads rows, which show a row only to the reader who opened it.
-- SECURITY DEFINER, and bound to the connection's tenant, for the reasons
-- count_announcement_deliveries is.
CREATE FUNCTION count_announcement_opens(announcement_id uuid) RETURNS bigint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT count(*)
    FROM public.announcement_reads r
    WHERE r.tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid
        AND r.announcement_id = count_announcement_opens.announcement_id
$$;
