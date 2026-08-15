import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;

  setUp(() async {
    server = ConnectFixtureServer(
      series: ConnectFixtureServer.populatedSeries(),
      details: ConnectFixtureServer.populatedDetails(),
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('unary decodes a Connect JSON success body', () async {
    final client = ConnectClient(baseUrl: server.baseUrl);
    final body = await client.unary(
      '/publira.v1.CatalogService/ListPublishedSeries',
      const {'limit': 20},
      tenantId: ConnectFixtureServer.defaultTenantId,
    );

    final series = body['series'] as List<dynamic>;
    expect(series, isNotEmpty);
    expect(
      (series.first as Map)['publicId'],
      ConnectFixtureServer.seedSeriesId,
    );
  });

  test('unary maps a Connect error code', () async {
    server.detailStatus = 503;
    final client = ConnectClient(baseUrl: server.baseUrl);

    expect(
      () => client.unary('/publira.v1.CatalogService/GetSeriesDetail', const {
        'publicId': 'x',
      }),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'unavailable',
        ),
      ),
    );
  });

  test('unary treats a closed port as unavailable', () async {
    await server.close();
    final client = ConnectClient(
      baseUrl: 'http://127.0.0.1:1',
      timeout: const Duration(milliseconds: 200),
    );

    expect(
      () => client.unary('/publira.v1.CatalogService/ListPublishedSeries', {}),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.isUnavailable,
          'isUnavailable',
          isTrue,
        ),
      ),
    );
  });
}
