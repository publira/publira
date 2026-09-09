-- A tenant's vocabulary of creator roles, and the credit column that used to
-- spell one out as free text.
--
-- series_creators.role was a varchar(50) nothing constrained: the admin API
-- wrote "creator", the development seed "author", the test helper "writer",
-- and no screen could group or order what came out. A role is a thing the
-- tenant names once — original author, artist, writer, supervisor, and
-- whatever else its catalogue needs — so it belongs in a table of its own,
-- the way genres do.
--
-- display_priority is what orders credits everywhere they are shown. Without
-- it every series would have to be ordered by hand for the original author to
-- lead, and two series would disagree the moment one of them was edited. Ties
-- are allowed: roles that carry the same weight fall back to the credit's own
-- display_order, and the id decides the rest.

-- TABLE: creator_roles
CREATE TABLE creator_roles (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    display_priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: creator_roles creator_roles_pkey
ALTER TABLE ONLY creator_roles
    ADD CONSTRAINT creator_roles_pkey PRIMARY KEY (id);

-- CONSTRAINT: creator_roles creator_roles_public_id_key
ALTER TABLE ONLY creator_roles
    ADD CONSTRAINT creator_roles_public_id_key UNIQUE (public_id);

-- CONSTRAINT: creator_roles creator_roles_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the role.
ALTER TABLE ONLY creator_roles
    ADD CONSTRAINT creator_roles_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: creator_roles creator_roles_tenant_id_fkey
ALTER TABLE ONLY creator_roles
    ADD CONSTRAINT creator_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: uq_creator_roles_tenant_name
-- A role list is a set of choices, so two entries that differ only in case are
-- two ways to pick the same thing. Genres settle that with a slug, which they
-- also need for their public URL; a role is never addressed by name, so the
-- lowercased name is the whole of it.
CREATE UNIQUE INDEX uq_creator_roles_tenant_name ON creator_roles USING btree (tenant_id, lower(name));

-- INDEX: idx_creator_roles_tenant_display_priority
-- The role list is read in the tenant's own order, and its cursor sorts on the
-- same (display_priority, id) pair. Two roles can share a priority, so the id
-- is what decides between them.
CREATE INDEX idx_creator_roles_tenant_display_priority ON creator_roles USING btree (tenant_id, display_priority, id);

-- ROW SECURITY: creator_roles
ALTER TABLE creator_roles ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_roles creator_roles_tenant_isolation
CREATE POLICY creator_roles_tenant_isolation ON creator_roles USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_creators — role_id replaces role
--
-- role_id is nullable, and that is the whole of what happens to the credits
-- that already exist. This migration creates no roles — writing rows a tenant
-- owns is tenant creation's job and the seeds', not a schema change's — so
-- there is no role for an existing credit to name. A credit says who is
-- credited, which is worth keeping whether or not it says in what capacity, so
-- it keeps its row and states no role. The admin API requires one on every
-- write, so NULL only ever means "written before roles existed".
ALTER TABLE series_creators
    ADD COLUMN role_id uuid;

ALTER TABLE series_creators
    DROP COLUMN role;

-- CONSTRAINT: series_creators series_creators_series_id_creator_id_role_id_key
-- The key widens so one person can hold two roles on the same series: an
-- original author who also draws it is two credits, not one row that has to
-- choose. It is a unique constraint rather than the primary key it replaces
-- because a primary key cannot hold a nullable column, and NULLS NOT DISTINCT
-- is what still keeps a creator from being credited twice without a role.
ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_pkey;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_series_id_creator_id_role_id_key UNIQUE NULLS NOT DISTINCT (series_id, creator_id, role_id);

-- FK CONSTRAINT: series_creators series_creators_tenant_role_id_fkey
-- No ON DELETE clause, for the reason series_genres has none: a role a credit
-- still names is not something the database drops on its own, which is what
-- makes deleting a role in use a refusal the console can explain rather than a
-- silent loss of the credit.
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_tenant_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES creator_roles(tenant_id, id);

-- INDEX: idx_series_creators_tenant_role
-- The read that starts from the role: the check that refuses to delete one a
-- credit still names. The unique constraint starts at series_id and serves the
-- other direction.
CREATE INDEX idx_series_creators_tenant_role ON series_creators USING btree (tenant_id, role_id, series_id);
