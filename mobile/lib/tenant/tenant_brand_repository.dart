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
      return TenantBrand(
        name: body.tenantName.trim(),
        palette: TenantPalette.fromHex({
          for (final color in TenantColor.values)
            color: _themeColor(theme, color),
        }),
        logo: _logo(theme.logoImageVariants),
      );
    } on ConnectException {
      return null;
    }
  }

  /// The logo's one variant, when it names an image with a size to lay out.
  TenantLogo? _logo(List<pb.TenantImageVariant> variants) {
    if (variants.isEmpty) {
      return null;
    }
    final variant = variants.first;
    final url = variant.url.trim();
    if (url.isEmpty || variant.width <= 0 || variant.height <= 0) {
      return null;
    }
    return TenantLogo(
      url: config.imageUri(url),
      width: variant.width,
      height: variant.height,
    );
  }

  static String _themeColor(pb.TenantTheme theme, TenantColor color) {
    return switch (color) {
      TenantColor.primary => theme.primaryColor,
      TenantColor.primaryForeground => theme.primaryForegroundColor,
      TenantColor.secondary => theme.secondaryColor,
      TenantColor.secondaryForeground => theme.secondaryForegroundColor,
      TenantColor.accent => theme.accentColor,
      TenantColor.accentForeground => theme.accentForegroundColor,
      TenantColor.background => theme.backgroundColor,
      TenantColor.foreground => theme.foregroundColor,
      TenantColor.surface => theme.surfaceColor,
      TenantColor.surfaceForeground => theme.surfaceForegroundColor,
      TenantColor.card => theme.cardColor,
      TenantColor.cardForeground => theme.cardForegroundColor,
      TenantColor.popover => theme.popoverColor,
      TenantColor.popoverForeground => theme.popoverForegroundColor,
      TenantColor.muted => theme.mutedColor,
      TenantColor.mutedForeground => theme.mutedForegroundColor,
      TenantColor.border => theme.borderColor,
      TenantColor.input => theme.inputColor,
      TenantColor.ring => theme.ringColor,
      TenantColor.success => theme.successColor,
      TenantColor.successForeground => theme.successForegroundColor,
      TenantColor.warning => theme.warningColor,
      TenantColor.warningForeground => theme.warningForegroundColor,
      TenantColor.destructive => theme.destructiveColor,
      TenantColor.destructiveForeground => theme.destructiveForegroundColor,
      TenantColor.info => theme.infoColor,
      TenantColor.infoForeground => theme.infoForegroundColor,
    };
  }
}
