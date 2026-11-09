-- A validated constraint cannot be marked NOT VALID again, so each is
-- recreated as the previous migration left it.
ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_tenant_actor_api_key_id_fkey,
    ADD CONSTRAINT audit_logs_tenant_actor_api_key_id_fkey FOREIGN KEY (tenant_id, actor_api_key_id) REFERENCES tenant_api_keys(tenant_id, id) NOT VALID;

ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_check,
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK ((num_nonnulls(actor_user_id, actor_public_id, actor_api_key_id) = CASE WHEN ((actor_role)::text = 'system'::text) THEN 0 ELSE 1 END)) NOT VALID;

ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_actor_api_key_id_check,
    ADD CONSTRAINT audit_logs_actor_api_key_id_check CHECK (((actor_api_key_id IS NOT NULL) = ((actor_role)::text = 'api_key'::text))) NOT VALID;
