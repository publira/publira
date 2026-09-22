import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
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

  test('reads the name, colours, and logo the tenant stored', () async {
    server.tenantTheme = {
      'primaryColor': '#0b6e4f',
      'logoImageVariants': [
        {
          'label': 'logo',
          'variantType': 'logo',
          'url': '/images/tenants/LOGO/logo',
          'width': 320,
          'height': 80,
        },
      ],
    };

    final brand = await repository().read();

    expect(brand?.name, ConnectFixtureServer.seedTenantName);
    expect(brand?.palette[TenantColor.primary], const Color(0xFF0B6E4F));
    expect(
      brand?.logo?.url,
      Uri.parse('${server.baseUrl}/images/tenants/LOGO/logo'),
    );
    expect(brand?.logo?.width, 320);
    final request = server.requestsTo('GetTenant').single;
    expect(request.body['tenant'], {
      'tenantId': ConnectFixtureServer.defaultTenantId,
    });
  });

  test('a tenant with no theme reads as the brand defaults', () async {
    final brand = await repository().read();

    expect(brand?.logo, isNull);
    expect(brand?.palette[TenantColor.primary], TenantColor.primary.fallback);
  });

  test('a logo with no size to lay out is no logo', () async {
    server.tenantTheme = {
      'logoImageVariants': [
        {'url': '/images/tenants/LOGO/logo', 'width': 0, 'height': 0},
      ],
    };

    expect((await repository().read())?.logo, isNull);
  });

  test('an API that cannot answer reads as no brand', () async {
    server.tenantStatus = HttpStatus.serviceUnavailable;

    expect(await repository().read(), isNull);
  });
}
