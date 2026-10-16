-- Passkeys on the storefront: a reader signs in with one alone, so a sign-in
-- ceremony begins before any account is named.

-- relying_party is which of the tenant's two relying parties a credential was
-- registered with, the console's or the storefront's. rp_id alone cannot tell
-- them apart: it follows the tenant's domains, a console served on the
-- storefront's host under another port shares its hostname, and a credential
-- of an RP ID the tenant no longer derives still has to be counted with the
-- surface it belongs to. Every credential so far is the console's.
ALTER TABLE user_webauthn_credentials
    ADD COLUMN relying_party text DEFAULT 'admin_console' NOT NULL,
    ADD CONSTRAINT user_webauthn_credentials_relying_party_check CHECK ((relying_party = ANY (ARRAY['admin_console'::text, 'site'::text])));

ALTER TABLE user_webauthn_credentials
    ALTER COLUMN relying_party DROP DEFAULT;

-- A ceremony belongs to one relying party too, so a challenge begun on one
-- surface is never spent on the other. A storefront sign-in names no account
-- until the authenticator answers with the credential it picked, so its row
-- has no user_id; every other ceremony is for the account that began it.
ALTER TABLE user_webauthn_ceremonies
    ADD COLUMN relying_party text DEFAULT 'admin_console' NOT NULL,
    ADD CONSTRAINT user_webauthn_ceremonies_relying_party_check CHECK ((relying_party = ANY (ARRAY['admin_console'::text, 'site'::text]))),
    ALTER COLUMN user_id DROP NOT NULL,
    ADD CONSTRAINT user_webauthn_ceremonies_user_id_check CHECK (((user_id IS NOT NULL) OR ((relying_party = 'site'::text) AND (ceremony = 'authentication'::text))));

ALTER TABLE user_webauthn_ceremonies
    ALTER COLUMN relying_party DROP DEFAULT;
