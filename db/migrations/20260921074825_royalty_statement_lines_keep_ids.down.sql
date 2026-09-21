-- A line whose catalog row was deleted while the up migration was in effect
-- still names it. The foreign keys below cannot validate such an ID, so it
-- goes back to NULL, the form the old keys left behind. The immutability
-- trigger refuses that update, so it is disabled around it.
ALTER TABLE royalty_statement_lines DISABLE TRIGGER royalty_statement_lines_immutable;

UPDATE royalty_statement_lines l SET creator_id = NULL
WHERE creator_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM creators c WHERE c.tenant_id = l.tenant_id AND c.id = l.creator_id);

UPDATE royalty_statement_lines l SET series_id = NULL
WHERE series_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM series s WHERE s.tenant_id = l.tenant_id AND s.id = l.series_id);

UPDATE royalty_statement_lines l SET episode_id = NULL
WHERE episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.tenant_id = l.tenant_id AND e.id = l.episode_id);

UPDATE royalty_statement_lines l SET role_id = NULL
WHERE role_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM creator_roles r WHERE r.tenant_id = l.tenant_id AND r.id = l.role_id);

ALTER TABLE royalty_statement_lines ENABLE TRIGGER royalty_statement_lines_immutable;

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES creator_roles(tenant_id, id) ON DELETE SET NULL (role_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE SET NULL (episode_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE SET NULL (series_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE SET NULL (creator_id);
