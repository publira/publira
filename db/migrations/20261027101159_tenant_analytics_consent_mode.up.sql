-- COLUMN: tenant_analytics_settings consent_mode
-- Whether the storefront asks a reader before the Google tag stores anything.
-- not_required runs the tag as soon as the page loads; opt_in asks first and
-- sends Google Consent Mode v2 signals that match the answer; external sends
-- defaults of denied and leaves the asking to a consent tool in the tenant's
-- Tag Manager container, so the server refuses it without a container ID. The
-- mode applies to every reader of the tenant.
ALTER TABLE ONLY tenant_analytics_settings
    ADD COLUMN consent_mode text DEFAULT 'not_required'::text NOT NULL,
    ADD CONSTRAINT tenant_analytics_settings_consent_mode_check CHECK (consent_mode IN ('not_required', 'opt_in', 'external'));
