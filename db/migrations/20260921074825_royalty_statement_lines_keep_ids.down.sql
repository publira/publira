ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES creator_roles(tenant_id, id) ON DELETE SET NULL (role_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE SET NULL (episode_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE SET NULL (series_id);

ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE SET NULL (creator_id);
