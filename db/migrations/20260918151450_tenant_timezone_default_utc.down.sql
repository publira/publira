ALTER TABLE platform_config ALTER COLUMN default_timezone SET DEFAULT 'Asia/Tokyo'::text;
ALTER TABLE tenants ALTER COLUMN timezone SET DEFAULT 'Asia/Tokyo'::text;
