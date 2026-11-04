-- INDEX: idx_purchases_tenant_purchased_at_tips
-- The tips among a tenant's purchases, with the columns the console's revenue
-- statistics read of one, so the part of a range of days that tips account
-- for is totalled from this index alone, as the rest of the range is from
-- idx_purchases_tenant_purchased_at_id_sales, which does not carry the kind.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_purchased_at_tips ON purchases USING btree (tenant_id, purchased_at) INCLUDE (currency, is_test, price_at_purchase) WHERE (kind = 'tip'::text);
