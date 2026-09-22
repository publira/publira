import 'package:publira/push/firebase_config.dart';

/// Runtime connection settings for the public API.
///
/// Values come from `--dart-define` so a test stack, emulator, or local
/// `task dev` can point the same binary at a different host without a rebuild
/// of flavors.
class AppConfig {
  const AppConfig({
    required this.baseUrl,
    required this.tenantHost,
    this.firebase,
  });

  factory AppConfig.fromEnvironment() {
    return AppConfig(
      baseUrl: const String.fromEnvironment(
        'PUBLIRA_BASE_URL',
        defaultValue: defaultBaseUrl,
      ),
      tenantHost: const String.fromEnvironment(
        'PUBLIRA_TENANT_HOST',
        defaultValue: defaultTenantHost,
      ),
      firebase: FirebaseConfig.fromEnvironment(),
    );
  }

  /// The edge listener of `publira server` (not the internal gRPC port),
  /// which serves the public API under `/api` and the images under `/images`.
  static const defaultBaseUrl = 'http://127.0.0.1:8000';

  /// Dev-seed tenant host (`db/seeds/dev/001_tenant_users.sql`).
  static const defaultTenantHost = 'localhost';

  /// Android emulator loopback to the host machine.
  static const androidEmulatorBaseUrl = 'http://10.0.2.2:8000';

  /// The origin the public API and the images are served from, whether that
  /// is the tenant's site behind the edge or `publira server` itself.
  final String baseUrl;
  final String tenantHost;

  /// The Firebase project the push notifications arrive from, or `null` when
  /// this build was given none and push is off.
  final FirebaseConfig? firebase;

  /// Resolves an `image_url` from the API against [baseUrl]. The API
  /// hands out a host-relative path, and keeps the media token it may carry in
  /// the query, so the whole reference has to survive the join.
  Uri imageUri(String imageUrl) =>
      Uri.parse(baseUrl).resolveUri(Uri.parse(imageUrl));

  /// Headers a public image request carries.
  ///
  /// A series eye-catch is served to every reader alike, so only the tenant
  /// travels: the reader's bearer token would unlock nothing and would turn
  /// one shared, cacheable cover into a response held per reader.
  Map<String, String> get publicImageRequestHeaders => imageRequestHeaders('');

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
