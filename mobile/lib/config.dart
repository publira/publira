/// Runtime connection settings for the public API.
///
/// Values come from `--dart-define` so a test stack, emulator, or local
/// `task dev` can point the same binary at a different host without a rebuild
/// of flavors.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.tenantHost});

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'PUBLIRA_API_BASE_URL',
        defaultValue: defaultApiBaseUrl,
      ),
      tenantHost: String.fromEnvironment(
        'PUBLIRA_TENANT_HOST',
        defaultValue: defaultTenantHost,
      ),
    );
  }

  /// Connect HTTP listener of `api-server` (not the internal gRPC port).
  static const defaultApiBaseUrl = 'http://127.0.0.1:8000';

  /// Dev-seed tenant host (`db/seeds/dev/001_tenant_users.sql`).
  static const defaultTenantHost = 'localhost';

  /// Android emulator loopback to the host machine.
  static const androidEmulatorApiBaseUrl = 'http://10.0.2.2:8000';

  final String apiBaseUrl;
  final String tenantHost;

  Uri get apiBaseUri => Uri.parse(apiBaseUrl);
}
