/// Runtime connection settings for the public API.
///
/// Values come from `--dart-define` so a test stack, emulator, or local
/// `task dev` can point the same binary at a different host without a rebuild
/// of flavors.
class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    required this.tenantHost,
    this.imageBaseUrl = defaultImageBaseUrl,
    this.accessToken = '',
  });

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
      imageBaseUrl: String.fromEnvironment(
        'PUBLIRA_IMAGE_BASE_URL',
        defaultValue: defaultImageBaseUrl,
      ),
      accessToken: String.fromEnvironment('PUBLIRA_ACCESS_TOKEN'),
    );
  }

  /// Connect HTTP listener of `api-server` (not the internal gRPC port).
  static const defaultApiBaseUrl = 'http://127.0.0.1:8000';

  /// HTTP listener of `image-server`, which serves episode body images.
  static const defaultImageBaseUrl = 'http://127.0.0.1:8200';

  /// Dev-seed tenant host (`db/seeds/dev/001_tenant_users.sql`).
  static const defaultTenantHost = 'localhost';

  /// Android emulator loopback to the host machine.
  static const androidEmulatorApiBaseUrl = 'http://10.0.2.2:8000';
  static const androidEmulatorImageBaseUrl = 'http://10.0.2.2:8200';

  final String apiBaseUrl;
  final String imageBaseUrl;
  final String tenantHost;

  /// Public-audience JWT sent as `Authorization: Bearer` on every API and
  /// image request. Empty means an anonymous reader, which reaches free
  /// episode bodies and nothing else.
  // TODO(#1274): drop the define once the app can sign in and hold its own
  // token; until then a build define is the only way to read a paid body.
  final String accessToken;

  Uri get apiBaseUri => Uri.parse(apiBaseUrl);

  /// Resolves an `image_url` from the API against [imageBaseUrl]. The API
  /// hands out a host-relative path, and keeps the media token it may carry in
  /// the query, so the whole reference has to survive the join.
  Uri imageUri(String imageUrl) =>
      Uri.parse(imageBaseUrl).resolveUri(Uri.parse(imageUrl));

  /// Headers every image-server request carries.
  ///
  /// image-server picks the tenant from the request host, which is the ingress
  /// hostname in a deployment but an address or an emulator loopback here, so
  /// the tenant travels in `X-Forwarded-Host` the way the reverse proxy sends
  /// it.
  Map<String, String> get imageRequestHeaders {
    final tenant = tenantHost.trim();
    final token = accessToken.trim();
    return {
      if (tenant.isNotEmpty) 'x-forwarded-host': tenant,
      if (token.isNotEmpty) 'authorization': 'Bearer $token',
    };
  }
}
