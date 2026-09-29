-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY tenant_config
    DROP CONSTRAINT tenant_config_ios_app_association_check,
    ADD CONSTRAINT tenant_config_ios_app_association_check CHECK (
        ((ios_team_id IS NULL) = (ios_bundle_identifier IS NULL))
        AND ((ios_team_id IS NULL) OR (ios_team_id ~ '^[A-Z0-9]{10}$'::text))
        AND ((ios_bundle_identifier IS NULL) OR (ios_bundle_identifier ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'::text))
    ) NOT VALID,
    DROP CONSTRAINT tenant_config_android_app_association_check,
    ADD CONSTRAINT tenant_config_android_app_association_check CHECK (
        ((android_application_id IS NULL) = (cardinality(android_sha256_cert_fingerprints) = 0))
        AND ((android_application_id IS NULL) OR (android_application_id ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'::text))
        AND (array_position(android_sha256_cert_fingerprints, NULL::text) IS NULL)
        AND ((cardinality(android_sha256_cert_fingerprints) = 0) OR (array_to_string(android_sha256_cert_fingerprints, ' '::text) ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){31}( [0-9A-F]{2}(:[0-9A-F]{2}){31})*$'::text))
    ) NOT VALID;
