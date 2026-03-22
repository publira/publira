UPDATE tenants
SET domain = public_id || '.example.com'
WHERE domain IS NULL OR btrim(domain) = '';

ALTER TABLE tenants
ALTER COLUMN domain SET NOT NULL;

ALTER TABLE tenants
DROP COLUMN IF EXISTS subdomain;
