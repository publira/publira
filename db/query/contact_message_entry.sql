-- The exchange that follows a contact message: the answers staff send and the
-- replies readers mail back.
--
-- Expected plans:
--   CreateContactMessageEntry, CreateReaderContactMessageEntry
--     -> contact_message_entries_pkey and
--        contact_message_entries_tenant_message_id_key for the uniqueness checks
--   ListContactMessageEntriesByMessageIDs
--     -> contact_message_entries_tenant_message_id_key
--   ListContactMessageEntries, ListContactMessageEntryMessageIDsBefore
--     -> idx_contact_message_entries_tenant_message_created_at
--   GetContactMessageEntryForTenant
--     -> contact_message_entries_pkey, then users_tenant_id_id_key

-- name: CreateContactMessageEntry :one
INSERT INTO contact_message_entries (
    id,
    tenant_id,
    contact_message_id,
    direction,
    author_id,
    body,
    message_id,
    from_email
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('contact_message_id'),
    sqlc.arg('direction'),
    sqlc.narg('author_id'),
    sqlc.arg('body'),
    sqlc.narg('message_id'),
    sqlc.narg('from_email')
)
RETURNING *;

-- name: CreateReaderContactMessageEntry :one
-- A reply the reader mailed back, as the inbound webhook stores it. A provider
-- delivers a mail again whenever it is not sure the first delivery landed, so
-- a Message-ID already stored is a redelivery: nothing is written and no row
-- comes back. A mail that came in without one cannot be told from a new one
-- and is stored each time.
INSERT INTO contact_message_entries (
    id,
    tenant_id,
    contact_message_id,
    direction,
    body,
    message_id,
    from_email
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('contact_message_id'),
    'reader',
    sqlc.arg('body'),
    sqlc.narg('message_id'),
    sqlc.arg('from_email')
)
ON CONFLICT (tenant_id, message_id) DO NOTHING
RETURNING *;

-- name: ListContactMessageEntriesByMessageIDs :many
-- The entries a mail's In-Reply-To and References name, which is how a reply
-- sent to an address other than the per-message one still finds its message.
-- The caller decides which of them the mail answers.
SELECT e.message_id::text AS message_id,
    e.contact_message_id
FROM contact_message_entries e
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.message_id = ANY(sqlc.arg('message_ids')::text[]);

-- name: ListContactMessageEntries :many
-- One message's exchange as the console shows it under the message, oldest
-- first so it reads in the order it was written. The author is joined for the
-- name the console prints beside a staff entry.
SELECT e.*,
    u.public_id AS author_public_id,
    u.name AS author_name
FROM contact_message_entries e
    LEFT JOIN users u ON u.tenant_id = e.tenant_id
        AND u.id = e.author_id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.contact_message_id = sqlc.arg('contact_message_id')
ORDER BY e.created_at ASC,
    e.id ASC;

-- name: GetContactMessageEntryForTenant :one
-- What the outbox worker reads to send a staff entry. The author's address and
-- status come with it, because the address is where the reader's reply goes.
SELECT e.*,
    u.email AS author_email,
    u.status AS author_status
FROM contact_message_entries e
    LEFT JOIN users u ON u.tenant_id = e.tenant_id
        AND u.id = e.author_id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id');

-- name: ListContactMessageEntryMessageIDsBefore :many
-- The Message-IDs of the entries written before one entry of the same
-- message, oldest first: the last is what the entry's mail is In-Reply-To, and
-- all of them are its References. An entry that came in without one has
-- nothing to name and is left out.
SELECT e.message_id::text AS message_id
FROM contact_message_entries e
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.contact_message_id = sqlc.arg('contact_message_id')
    AND e.message_id IS NOT NULL
    AND (e.created_at, e.id) < (
        sqlc.arg('before_created_at')::timestamptz,
        sqlc.arg('before_id')::uuid
    )
ORDER BY e.created_at ASC,
    e.id ASC;
