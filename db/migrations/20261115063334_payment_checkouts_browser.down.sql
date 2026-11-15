ALTER TABLE payment_checkouts
    DROP CONSTRAINT payment_checkouts_request_object_check,
    DROP COLUMN payment_id,
    DROP COLUMN request;
