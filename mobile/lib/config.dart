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

  Uri get apiBaseUri => Uri.parse(apiBaseUrl);

  /// Resolves an `image_url` from the API against [imageBaseUrl]. The API
  /// hands out a host-relative path, and keeps the media token it may carry in
  /// the query, so the whole reference has to survive the join.
  Uri imageUri(String imageUrl) =>
      Uri.parse(imageBaseUrl).resolveUri(Uri.parse(imageUrl));

  /// Headers an image-server request carries for a reader holding
  /// [accessToken], which is empty for an anonymous one.
  ///
  /// image-server picks the tenant from the request host, which is the ingress
  /// hostname in a deployment but an address or an emulator loopback here, so
  /// the tenant travels in `X-Forwarded-Host` the way the reverse proxy sends
  /// it.
  Map<String, String> imageRequestHeaders(String accessToken) {
    final tenant = tenantHost.trim();
    final token = accessToken.trim();
    return {
      if (tenant.isNotEmpty) 'x-forwarded-host': tenant,
      if (token.isNotEmpty) 'authorization': 'Bearer $token',
    };
  }
}
