-- Auth-mail payloads stored the raw token so the worker could render
-- the link. Terminal rows no longer need it, and leaving it in
-- payload would keep a usable secret for as long as the row exists.
-- Drop the key from already-processed auth-mail events; pending and
-- processing rows still need the token until they finish. Other
-- event types keep payload.token. Keep this list in sync with
-- MarkOutboxEventDone and MarkOutboxEventDead.

UPDATE outbox_events
SET payload = payload - 'token'
WHERE status IN ('done', 'dead')
    AND payload ? 'token'
    AND event_type IN (
        'admin_email_change_confirmation_email',
        'admin_password_reset_email',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_password_reset_email',
        'tenant_admin_invitation_email'
    );
