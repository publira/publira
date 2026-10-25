-- COLUMN: tenants.image_domain
-- The host a tenant's storefront images are served on when they are not served
-- on its domain: image delivery answers it as the storefront, and the public
-- API hands out image URLs on it. NULL keeps the images on the domain. Like
-- admin_domain, no two tenants may hold the same one; the collisions a unique
-- constraint cannot see, such as another tenant's domain, are refused by the
-- writes under LockTenantHosts.
ALTER TABLE tenants
    ADD COLUMN image_domain text,
    ADD CONSTRAINT tenants_image_domain_key UNIQUE (image_domain);
