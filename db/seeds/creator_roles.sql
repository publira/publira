-- The creator-role vocabulary every tenant starts with, for the tenants a seed
-- created. Tenant creation gives a new tenant these four; a seeded tenant is
-- written straight into the table and never goes through it, so it gets them
-- here. A credit names a role and the column is NOT NULL, so a tenant without
-- them cannot credit anybody.
--
-- Included with `\ir` from every seed that inserts a tenant, rather than copied
-- into each, so the list has one place to be read and changed.
--
-- The id and public_id are derived from the tenant and the role name rather
-- than drawn at random, which is what makes re-running a seed find the rows it
-- wrote instead of writing a second set. The public_id is the first 12
-- characters of that digest with the hexadecimal symbols Base58 has no place
-- for translated onto ones it does, which keeps it inside the alphabet
-- server/internal/publicid generates from.
INSERT INTO creator_roles (id, tenant_id, public_id, name, display_priority)
SELECT
    MD5('creator_role:' || t.id::text || ':' || r.name)::uuid,
    t.id,
    TRANSLATE(SUBSTR(MD5('creator_role:' || t.id::text || ':' || r.name), 1, 12), '0abcdef', 'zABCDEF'),
    r.name,
    r.display_priority
FROM tenants t
CROSS JOIN (
    VALUES ('Original Author', 1),
        ('Artist', 2),
        ('Writer', 3),
        ('Supervisor', 4)
) AS r(name, display_priority)
ON CONFLICT (tenant_id, lower(name)) DO NOTHING;
