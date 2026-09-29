-- A statement line keeps the IDs of the creator, series, episode and role it
-- was closed with, as it keeps their names: a publisher's accounting matches
-- the exported statement by those IDs, so deleting a catalog row later must not
-- blank them. The foreign keys that nulled them on delete go; the close writes
-- the IDs from the rows it reads in the same transaction.

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_creator_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_tenant_creator_id_fkey;

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_series_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_tenant_series_id_fkey;

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_episode_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_tenant_episode_id_fkey;

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_role_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_tenant_role_id_fkey;
