import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/config.dart';
import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_repository.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  HttpTenantBrandRepository repository() {
    final client = ConnectClient(baseUrl: server.baseUrl);
    return HttpTenantBrandRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  test('reads the name, colours, and images the tenant stored', () async {
    server.tenantTheme = pb.TenantTheme(
      primaryColor: '#0b6e4f',
      logoImageVariants: [
        pb.TenantImageVariant(
          label: 'logo',
          variantType: 'logo',
          url: '/images/tenants/LOGO/logo',
          width: 320,
          height: 80,
        ),
      ],
      signInImageVariants: [
        pb.TenantImageVariant(
          label: 'sign_in',
          variantType: 'sign_in',
          url: '/images/tenants/SIGNIN/sign_in',
          width: 1600,
          height: 1200,
        ),
      ],
    );

    final brand = await repository().read();

    expect(brand?.name, ConnectFixtureServer.seedTenantName);
    expect(brand?.palette[TenantColor.primary], const Color(0xFF0B6E4F));
    expect(
      brand?.logo?.url,
      Uri.parse('${server.baseUrl}/images/tenants/LOGO/logo'),
    );
    expect(brand?.logo?.width, 320);
    expect(
      brand?.signInImage?.url,
      Uri.parse('${server.baseUrl}/images/tenants/SIGNIN/sign_in'),
    );
    expect(brand?.signInImage?.height, 1200);
    expect(
      server.requestsOf(pb.GetTenantRequest.new).single.tenant,
      pb.TenantContext(tenantId: ConnectFixtureServer.defaultTenantId),
    );
  });

  test('reads the dark palette the tenant stored', () async {
    server.tenantDarkTheme = pb.TenantThemePalette(
      primaryColor: '#6fd3a8',
      primaryForegroundColor: '#0c1a15',
      secondaryColor: '#f08a5d',
      secondaryForegroundColor: '#0c1a15',
      accentColor: '#1f3a30',
      accentForegroundColor: '#e3f2ec',
      backgroundColor: '#0c1a15',
      foregroundColor: '#e3f2ec',
      surfaceColor: '#12241d',
      surfaceForegroundColor: '#e3f2ec',
      cardColor: '#152a22',
      cardForegroundColor: '#e3f2ec',
      popoverColor: '#152a22',
      popoverForegroundColor: '#e3f2ec',
      mutedColor: '#1f3a30',
      mutedForegroundColor: '#a9c4b9',
      borderColor: '#2b4a3e',
      inputColor: '#2b4a3e',
      ringColor: '#6fd3a8',
      successColor: '#7bd88f',
      successForegroundColor: '#0c1a15',
      warningColor: '#f2c14e',
      warningForegroundColor: '#0c1a15',
      destructiveColor: '#f28b82',
      destructiveForegroundColor: '#0c1a15',
      infoColor: '#8ab4f8',
      infoForegroundColor: '#0c1a15',
    );

    final dark = (await repository().read())?.darkPalette;

    expect(dark?[TenantColor.primary], const Color(0xFF6FD3A8));
    expect(dark?[TenantColor.background], const Color(0xFF0C1A15));
    expect(dark?[TenantColor.infoForeground], const Color(0xFF0C1A15));
  });

  test('a tenant with no theme reads as the brand defaults', () async {
    final brand = await repository().read();

    expect(brand?.darkPalette, isNull);

    expect(brand?.logo, isNull);
    expect(brand?.signInImage, isNull);
    expect(brand?.palette[TenantColor.primary], TenantColor.primary.fallback);
  });

  test('a logo with no size to lay out is no logo', () async {
    server.tenantTheme = pb.TenantTheme(
      logoImageVariants: [
        pb.TenantImageVariant(
          url: '/images/tenants/LOGO/logo',
          width: 0,
          height: 0,
        ),
      ],
    );

    expect((await repository().read())?.logo, isNull);
  });

  test('an API that cannot answer reads as no brand', () async {
    server.tenantStatus = HttpStatus.serviceUnavailable;

    expect(await repository().read(), isNull);
  });
}
