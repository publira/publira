-- The identities of the tenant's Android and iOS apps, which the storefront
-- names in assetlinks.json and apple-app-site-association so that its links
-- open in those apps. Each platform is either configured whole or not at all,
-- and a tenant without an app on it leaves it unconfigured.
--
-- The CHECK constraints are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE lock without scanning the table; the next migration validates them
-- under a lock that lets reads and writes continue.

-- COLUMN: tenant_config android_application_id, android_sha256_cert_fingerprints
-- The production application ID and the SHA-256 fingerprints of every
-- certificate the published app is signed with, colon-separated uppercase hex.
-- The patterns are the app manifest's, so a value copied from it is accepted.
ALTER TABLE ONLY tenant_config
    ADD COLUMN android_application_id text,
    ADD COLUMN android_sha256_cert_fingerprints text[] DEFAULT '{}'::text[] NOT NULL,
    ADD CONSTRAINT tenant_config_android_app_association_check CHECK (
        ((android_application_id IS NULL) = (cardinality(android_sha256_cert_fingerprints) = 0))
        AND ((android_application_id IS NULL) OR (android_application_id ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'::text))
        AND (array_position(android_sha256_cert_fingerprints, NULL::text) IS NULL)
        AND ((cardinality(android_sha256_cert_fingerprints) = 0) OR (array_to_string(android_sha256_cert_fingerprints, ' '::text) ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){31}( [0-9A-F]{2}(:[0-9A-F]{2}){31})*$'::text))
    ) NOT VALID;

-- COLUMN: tenant_config ios_team_id, ios_bundle_identifier
-- The Apple Team ID the app is published under and its production bundle
-- identifier, which apple-app-site-association joins as <team>.<bundle>.
ALTER TABLE ONLY tenant_config
    ADD COLUMN ios_team_id text,
    ADD COLUMN ios_bundle_identifier text,
    ADD CONSTRAINT tenant_config_ios_app_association_check CHECK (
        ((ios_team_id IS NULL) = (ios_bundle_identifier IS NULL))
        AND ((ios_team_id IS NULL) OR (ios_team_id ~ '^[A-Z0-9]{10}$'::text))
        AND ((ios_bundle_identifier IS NULL) OR (ios_bundle_identifier ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'::text))
    ) NOT VALID;
