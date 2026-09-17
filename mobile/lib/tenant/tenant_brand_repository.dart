import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/config.dart';
import 'package:publira/tenant/tenant_brand.dart';

/// Reads the brand of the tenant the app was built for.
abstract class TenantBrandRepository {
  /// The tenant's brand, or `null` when the API could not answer for it.
  Future<TenantBrand?> read();
}

/// [TenantBrandRepository] backed by `publira.v1.TenantService/GetTenant`.
class HttpTenantBrandRepository implements TenantBrandRepository {
  const HttpTenantBrandRepository({
    required this.config,
    required this._client,
    required this._tenants,
  });

  static const _procedure = '/publira.v1.TenantService/GetTenant';

  final AppConfig config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<TenantBrand?> read() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_procedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      final theme = body['theme'];
      final rawName = body['tenantName'];
      return TenantBrand(
        name: rawName is String ? rawName.trim() : '',
        palette: TenantPalette.fromWire(theme),
        logo: theme is Map ? _logo(theme['logoImageVariants']) : null,
      );
    } on ConnectException {
      return null;
    }
  }

  /// The logo's one variant, when it names an image with a size to lay out.
  TenantLogo? _logo(Object? variants) {
    if (variants is! List || variants.isEmpty) {
      return null;
    }
    final variant = variants.first;
    if (variant is! Map) {
      return null;
    }
    final url = variant['url'];
    final width = variant['width'];
    final height = variant['height'];
    if (url is! String ||
        url.trim().isEmpty ||
        width is! int ||
        height is! int ||
        width <= 0 ||
        height <= 0) {
      return null;
    }
    return TenantLogo(
      url: config.imageUri(url.trim()),
      width: width,
      height: height,
    );
  }
}
