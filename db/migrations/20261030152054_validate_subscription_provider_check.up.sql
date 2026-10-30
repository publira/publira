-- Validates the CHECK constraints the store subscription migration added NOT
-- VALID. It is a file of its own because golang-migrate runs one file as one
-- transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE,
-- which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY subscriptions
    VALIDATE CONSTRAINT subscriptions_provider_check;

ALTER TABLE ONLY subscriptions
    VALIDATE CONSTRAINT subscriptions_store_subscription_id_check;
