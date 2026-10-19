-- COLUMN: purchases provider_promotion_code_id
-- The provider's id of the promotion code the reader entered at its checkout,
-- and NULL when they entered none. price_at_purchase is then what the reader
-- paid once the code's discount was taken off, which is what a refund and a
-- royalty statement have to be measured against; this column says why it is
-- below the price the checkout was started at. The column is nullable with no
-- default, so adding it does not rewrite the table.
ALTER TABLE ONLY purchases
    ADD COLUMN provider_promotion_code_id text;
