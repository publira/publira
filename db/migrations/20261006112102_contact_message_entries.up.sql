-- The exchange that follows a contact message: each answer staff send and each
-- reply the reader writes back. The reader's first message stays on
-- contact_messages; a row here is everything said after it.

-- TABLE: contact_message_entries
CREATE TABLE contact_message_entries (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    contact_message_id uuid NOT NULL,
    -- 'staff' for an answer sent from the console, 'reader' for a reply the
    -- reader mailed back.
    direction character varying(8) NOT NULL,
    -- The member of staff who wrote a staff entry. NULL on a reader entry, and
    -- on a staff entry whose author's account has been deleted since: the
    -- answer was still sent, so the entry stays.
    author_id uuid,
    body text NOT NULL,
    -- The RFC 5322 Message-ID the mail went out or came in with, without its
    -- angle brackets. A staff entry is given one before its mail is queued, so
    -- every retry sends the same id; a reader's mail may arrive without one.
    message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_message_entries_direction_check CHECK (((direction)::text = ANY ((ARRAY['staff'::character varying, 'reader'::character varying])::text[]))),
    CONSTRAINT contact_message_entries_author_id_check CHECK ((((direction)::text = 'staff'::text) OR (author_id IS NULL))),
    CONSTRAINT contact_message_entries_body_check CHECK (((length(body) > 0) AND (length(body) <= 4000))),
    -- 998 is the longest line RFC 5322 allows, and a header longer than one
    -- line could not be written back into In-Reply-To.
    CONSTRAINT contact_message_entries_message_id_check CHECK (((message_id IS NULL) OR ((length(message_id) > 0) AND (length(message_id) <= 998)))),
    CONSTRAINT contact_message_entries_staff_message_id_check CHECK ((((direction)::text <> 'staff'::text) OR (message_id IS NOT NULL)))
);

-- CONSTRAINT: contact_message_entries contact_message_entries_pkey
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_pkey PRIMARY KEY (id);

-- CONSTRAINT: contact_message_entries contact_message_entries_tenant_message_id_key
-- One mail is one entry. A Message-ID is meant to be unique to the mail that
-- carries it, so the same one arriving twice is a redelivery, and a reply's
-- In-Reply-To finds the single entry it answers.
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_tenant_message_id_key UNIQUE (tenant_id, message_id);

-- FK CONSTRAINT: contact_message_entries contact_message_entries_tenant_id_fkey
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: contact_message_entries contact_message_entries_tenant_contact_message_id_fkey
-- Composite, so an entry cannot hang under another tenant's message. CASCADE
-- because the exchange means nothing without the message it follows.
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_tenant_contact_message_id_fkey FOREIGN KEY (tenant_id, contact_message_id) REFERENCES contact_messages(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: contact_message_entries contact_message_entries_tenant_author_id_fkey
-- SET NULL as contact_messages does for handled_by. The column list keeps
-- tenant_id out of the action, so the row does not lose the tenant its
-- isolation policy filters on.
ALTER TABLE ONLY contact_message_entries
    ADD CONSTRAINT contact_message_entries_tenant_author_id_fkey FOREIGN KEY (tenant_id, author_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (author_id);

-- INDEX: idx_contact_message_entries_tenant_message_created_at
-- One message's exchange in the order it happened, which is also the
-- referencing side of the CASCADE from contact_messages.
CREATE INDEX idx_contact_message_entries_tenant_message_created_at ON contact_message_entries USING btree (tenant_id, contact_message_id, created_at, id);

-- INDEX: idx_contact_message_entries_tenant_author_id
-- The referencing side of the SET NULL into users, for the reason
-- idx_contact_messages_tenant_handled_by exists: without it, deleting a staff
-- account scans every entry the tenant has.
CREATE INDEX idx_contact_message_entries_tenant_author_id ON contact_message_entries USING btree (tenant_id, author_id) WHERE (author_id IS NOT NULL);

-- ROW SECURITY: contact_message_entries
ALTER TABLE contact_message_entries ENABLE ROW LEVEL SECURITY;

-- POLICY: contact_message_entries contact_message_entries_tenant_isolation
CREATE POLICY contact_message_entries_tenant_isolation ON contact_message_entries USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
