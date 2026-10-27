import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
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

  final AppConfig config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<TenantBrand?> read() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.TenantServiceApi(_client).getTenant(
        ConnectCallContext(tenantId: tenantId),
        pb.GetTenantRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
      final theme = body.theme;
      // Both messages name their colours the way TenantColor.wireName does.
      return TenantBrand(
        name: body.tenantName.trim(),
        palette: TenantPalette.fromWire(theme.toProto3Json()),
        darkPalette: body.hasDarkTheme()
            ? TenantPalette.darkFromWire(body.darkTheme.toProto3Json())
            : null,
        logo: _image(theme.logoImageVariants),
        signInImage: _image(theme.signInImageVariants),
      );
    } on ConnectException {
      return null;
    }
  }

  /// The image's one variant, when it names an image with a size to lay out.
  /// The server keeps an upload's own proportions rather than cutting sizes
  /// of it, so a logo and a sign-in image each have one.
  TenantImage? _image(List<pb.TenantImageVariant> variants) {
    if (variants.isEmpty) {
      return null;
    }
    final variant = variants.first;
    final url = variant.url.trim();
    if (url.isEmpty || variant.width <= 0 || variant.height <= 0) {
      return null;
    }
    return TenantImage(
      url: config.imageUri(url),
      width: variant.width,
      height: variant.height,
    );
  }
}
