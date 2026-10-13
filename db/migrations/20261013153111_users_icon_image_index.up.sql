-- INDEX: idx_users_tenant_id_icon_image_id
-- What finds the account electing an image: the orphan sweep asks it of every
-- image row, and deleting an image row asks it again to clear the election.
-- Without it each of those is a scan of every account, and the sweep deletes
-- one image row per replaced icon. Partial, because most accounts elect none.
--
-- CONCURRENTLY, so building it does not block the sign-ups readers keep
-- making, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_users_tenant_id_icon_image_id ON users USING btree (tenant_id, icon_image_id) WHERE (icon_image_id IS NOT NULL);
