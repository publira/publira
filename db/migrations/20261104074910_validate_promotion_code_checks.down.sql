-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_list_price_check,
    ADD CONSTRAINT purchases_list_price_check CHECK (((list_price IS NULL) OR (list_price >= price_at_purchase))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_promotion_code_check,
    ADD CONSTRAINT purchases_promotion_code_check CHECK (((num_nonnulls(promotion_code_id, provider_promotion_code_id) <= 1) AND ((promotion_code_id IS NULL) OR (list_price IS NOT NULL)))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_promotion_code_id_fkey,
    ADD CONSTRAINT purchases_tenant_promotion_code_id_fkey FOREIGN KEY (tenant_id, promotion_code_id) REFERENCES promotion_codes(tenant_id, id) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_promotion_code_check,
    ADD CONSTRAINT store_purchase_intents_promotion_code_check CHECK (((promotion_code_id IS NULL) = (list_price IS NULL)) AND ((list_price IS NULL) OR (list_price >= price))) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_tenant_promotion_code_id_fkey,
    ADD CONSTRAINT store_purchase_intents_tenant_promotion_code_id_fkey FOREIGN KEY (tenant_id, promotion_code_id) REFERENCES promotion_codes(tenant_id, id) NOT VALID;
