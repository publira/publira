ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_refund_revokes_check,
    DROP CONSTRAINT purchases_revocation_reason_check;

ALTER TABLE purchases
    DROP COLUMN revocation_reason,
    DROP COLUMN revoked_at;
