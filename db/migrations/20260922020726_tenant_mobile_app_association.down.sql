-- Dropping each column takes its CHECK constraint with it.
ALTER TABLE ONLY tenant_config
    DROP COLUMN ios_bundle_identifier,
    DROP COLUMN ios_team_id,
    DROP COLUMN android_sha256_cert_fingerprints,
    DROP COLUMN android_application_id;
