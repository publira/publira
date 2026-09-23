-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY tenant_config
    DROP CONSTRAINT tenant_config_app_purchase_route_check,
    ADD CONSTRAINT tenant_config_app_purchase_route_check CHECK ((app_purchase_route = ANY (ARRAY['external_checkout'::text, 'store'::text]))) NOT VALID;
