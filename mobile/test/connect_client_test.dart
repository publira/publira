import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
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

  test('unary maps a non-JSON 502 response to unavailable', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response('<html>Bad Gateway</html>', 502);
      }),
    );

    expect(
      () => client.unary('/publira.v1.CatalogService/ListPublishedSeries', {}),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'unavailable',
        ),
      ),
    );
  });

  test('unary maps a malformed success response to internal', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async => http.Response('not JSON', 200)),
    );

    expect(
      () => client.unary('/publira.v1.CatalogService/ListPublishedSeries', {}),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'internal',
        ),
      ),
    );
  });

  test('unary treats a closed port as unavailable', () async {
    final closedBaseUrl = server.baseUrl;
    await server.close();
    final client = ConnectClient(
      baseUrl: closedBaseUrl,
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
