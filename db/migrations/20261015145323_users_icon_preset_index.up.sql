-- INDEX: idx_users_tenant_id_icon_preset_id
-- What finds the accounts electing a preset: deleting the preset asks it to
-- clear their election, and to name the comment lists that showed it. Without
-- it each of those is a scan of every account. Partial, because most accounts
-- elect none.
--
-- CONCURRENTLY, so building it does not block the sign-ups readers keep
-- making, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_users_tenant_id_icon_preset_id ON users USING btree (tenant_id, icon_preset_id) WHERE (icon_preset_id IS NOT NULL);
