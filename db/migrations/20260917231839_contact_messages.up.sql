-- Messages readers send the tenant through the contact form. Publira carries
-- no reply of its own, so a row is the whole record: what the reader wrote, the
-- address staff answer at, and whether anyone has dealt with it yet.

-- TABLE: contact_messages
CREATE TABLE contact_messages (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    -- The account that sent the message, NULL for a guest and for a reader
    -- whose account has been deleted since.
    user_id uuid,
    -- Where staff answer, as the reader typed it. A signed-in reader gives it
    -- too: the address they can be reached at is not always the one they
    -- signed up with.
    reply_to_email text NOT NULL,
    -- NULL for a message the reader gave no subject.
    subject text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- When staff marked the message dealt with, and who did. NULL while it is
    -- still waiting, which is what an inbox separates its unhandled messages
    -- by. The actor can be deleted afterwards and leave handled_by NULL, so
    -- handled_at alone says whether the message has been handled.
    handled_at timestamp with time zone,
    handled_by uuid,
    CONSTRAINT contact_messages_reply_to_email_check CHECK (((length(reply_to_email) > 0) AND (length(reply_to_email) <= 254))),
    CONSTRAINT contact_messages_subject_check CHECK (((subject IS NULL) OR ((length(subject) > 0) AND (length(subject) <= 200)))),
    CONSTRAINT contact_messages_body_check CHECK (((length(body) > 0) AND (length(body) <= 4000))),
    CONSTRAINT contact_messages_handled_by_check CHECK (((handled_by IS NULL) OR (handled_at IS NOT NULL)))
);

-- CONSTRAINT: contact_messages contact_messages_pkey
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);

-- CONSTRAINT: contact_messages contact_messages_tenant_public_id_key
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: contact_messages contact_messages_tenant_id_fkey
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: contact_messages contact_messages_tenant_user_id_fkey
-- SET NULL rather than CASCADE: a reader closing their account does not
-- withdraw the question they asked, and the tenant may still owe an answer to
-- the address on the message. It lists the column so the action does not null
-- tenant_id as well.
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- FK CONSTRAINT: contact_messages contact_messages_tenant_handled_by_fkey
ALTER TABLE ONLY contact_messages
    ADD CONSTRAINT contact_messages_tenant_handled_by_fkey FOREIGN KEY (tenant_id, handled_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (handled_by);

-- INDEX: idx_contact_messages_tenant_created_at
-- The inbox with no filter on it, newest first.
CREATE INDEX idx_contact_messages_tenant_created_at ON contact_messages USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_contact_messages_tenant_unhandled_created_at
-- The messages still waiting. Partial rather than an index on handled_at,
-- because the queue a tenant works from shrinks to nothing while the history
-- behind it keeps growing.
CREATE INDEX idx_contact_messages_tenant_unhandled_created_at ON contact_messages USING btree (tenant_id, created_at DESC, id DESC) WHERE (handled_at IS NULL);

-- INDEX: idx_contact_messages_tenant_handled_created_at
CREATE INDEX idx_contact_messages_tenant_handled_created_at ON contact_messages USING btree (tenant_id, created_at DESC, id DESC) WHERE (handled_at IS NOT NULL);

-- ROW SECURITY: contact_messages
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- POLICY: contact_messages contact_messages_tenant_isolation
CREATE POLICY contact_messages_tenant_isolation ON contact_messages USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
