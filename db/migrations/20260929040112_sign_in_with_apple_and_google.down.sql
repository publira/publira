DROP TABLE sign_in_nonces;

DROP TABLE user_identities;

DROP TABLE tenant_google_sign_in_config;

DROP TABLE tenant_apple_sign_in_config;

-- Fails while a reader without a password exists, rather than inventing one.
ALTER TABLE ONLY users
    ALTER COLUMN password_hash SET NOT NULL;
