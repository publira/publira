-- Take 'episode.published' away again.
--
-- An endpoint subscribed to it has nothing the earlier schema can hold it as,
-- and taking the event off it could leave it subscribed to nothing, so the
-- rollback refuses rather than rewriting the tenant's endpoints. Unsubscribe
-- or delete those endpoints first.
DO $$
DECLARE
    subscribed bigint;
BEGIN
    SELECT count(*) INTO subscribed FROM tenant_webhook_endpoints WHERE 'episode.published' = ANY (event_types);
    IF subscribed > 0 THEN
        RAISE EXCEPTION
            'cannot drop the episode.published webhook event: % endpoint(s) subscribe to it',
            subscribed;
    END IF;
END
$$;

ALTER TABLE ONLY tenant_webhook_endpoints
    DROP CONSTRAINT tenant_webhook_endpoints_event_types_check,
    ADD CONSTRAINT tenant_webhook_endpoints_event_types_check CHECK (((cardinality(event_types) >= 1) AND (event_types <@ ARRAY['purchase.completed'::text, 'purchase.refunded'::text, 'reader.signed_up'::text, 'subscription.started'::text, 'subscription.ended'::text])));
