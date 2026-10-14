-- COLUMN: contact_message_entries delivery_key
-- What the provider that delivered a reader entry's mail names that delivery
-- by, prefixed with the provider's id: Resend's email id, or what the Mailgun
-- provider derives from the mail's header. A redelivery of the same mail
-- repeats it, so it tells a redelivery apart from a new mail where message_id
-- cannot, on a mail that came in without a Message-ID. It is kept apart from
-- message_id because that column is what a later reply's In-Reply-To and
-- References are matched against, and no reply names a key the provider made
-- up. NULL on a staff entry, and on a reader entry whose provider has no such
-- key.
ALTER TABLE contact_message_entries
    ADD COLUMN delivery_key text;

-- CONSTRAINT: contact_message_entries contact_message_entries_delivery_key_check
-- Only a reader entry was delivered by a provider. No row carries a key
-- before this column exists, so every row already present passes.
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_delivery_key_check CHECK (
        (delivery_key IS NULL)
        OR (((direction)::text = 'reader'::text) AND (length(delivery_key) > 0) AND (length(delivery_key) <= 255))
    );
