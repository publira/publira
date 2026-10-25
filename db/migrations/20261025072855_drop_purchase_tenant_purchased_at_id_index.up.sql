-- INDEX: idx_purchases_tenant_purchased_at_id
-- idx_purchases_tenant_purchased_at_id_amounts serves everything this did, in
-- the same order, and two indexes over the same range of the same table only
-- make every purchase cost a second index write. CONCURRENTLY, so the drop
-- waits for no lock a storefront's writes hold.
DROP INDEX CONCURRENTLY IF EXISTS idx_purchases_tenant_purchased_at_id;
