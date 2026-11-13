DROP TRIGGER IF EXISTS tenant_payment_config_write_providers ON tenant_payment_config;
DROP TRIGGER IF EXISTS tenant_payment_providers_write_config ON tenant_payment_providers;
DROP FUNCTION IF EXISTS tenant_payment_config_write_providers();
DROP FUNCTION IF EXISTS tenant_payment_providers_write_config();
DROP TABLE IF EXISTS tenant_payment_providers;
