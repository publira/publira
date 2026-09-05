-- Auth-mail payloads stored the raw token so the worker could render
-- the link. Terminal rows no longer need it, and leaving it in
-- payload would keep a usable secret for as long as the row exists.
-- Drop the key from already-processed events; pending and processing
-- rows still need the token until they finish.

UPDATE outbox_events
SET payload = payload - 'token'
WHERE status IN ('done', 'dead')
    AND payload ? 'token';
