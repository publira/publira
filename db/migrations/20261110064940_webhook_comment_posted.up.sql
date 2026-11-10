-- CONSTRAINT: tenant_webhook_endpoints tenant_webhook_endpoints_event_types_check
-- 'comment.posted' is sent when a reader's comment becomes visible on an
-- episode. A tenant keeps at most five endpoints, so the constraint is
-- validated here.
ALTER TABLE ONLY tenant_webhook_endpoints
    DROP CONSTRAINT tenant_webhook_endpoints_event_types_check,
    ADD CONSTRAINT tenant_webhook_endpoints_event_types_check CHECK (((cardinality(event_types) >= 1) AND (event_types <@ ARRAY['purchase.completed'::text, 'purchase.refunded'::text, 'reader.signed_up'::text, 'subscription.started'::text, 'subscription.ended'::text, 'episode.published'::text, 'episode.unpublished'::text, 'comment.posted'::text])));
