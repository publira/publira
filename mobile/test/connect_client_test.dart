import 'dart:convert';

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

  test('unary maps a request that outruns the timeout', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      timeout: const Duration(milliseconds: 20),
      httpClient: MockClient((_) async {
        await Future<void>.delayed(const Duration(seconds: 1));
        return http.Response('{}', 200);
      }),
    );

    await expectLater(
      client.unary('/publira.v1.CatalogService/ListPublishedSeries', const {}),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'deadline_exceeded')
            .having((error) => error.isUnavailable, 'isUnavailable', isTrue),
      ),
    );
  });

  test('unary reads an empty success body as an empty message', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async => http.Response('', 200)),
    );

    final body = await client.unary(
      '/publira.v1.CatalogService/ListPublishedSeries',
      const {},
    );

    expect(body, isEmpty);
  });

  test('unary rejects a success body that is not a JSON object', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async => http.Response('[1, 2]', 200)),
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

  test('unary keeps the code and message an error body carries', () async {
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode(const {
            'code': 'not_found',
            'message': 'series not found',
          }),
          404,
        );
      }),
    );

    expect(
      () => client.unary('/publira.v1.CatalogService/GetSeriesDetail', {}),
      throwsA(
        isA<ConnectException>()
            .having((error) => error.code, 'code', 'not_found')
            .having((error) => error.message, 'message', 'series not found')
            .having((error) => error.isNotFound, 'isNotFound', isTrue),
      ),
    );
  });

  test(
    'unary falls back to the status when an error body has no code',
    () async {
      final client = ConnectClient(
        baseUrl: 'https://example.test',
        httpClient: MockClient((_) async {
          return http.Response('{}', 400);
        }),
      );

      expect(
        () => client.unary('/publira.v1.CatalogService/GetSeriesDetail', {}),
        throwsA(
          isA<ConnectException>()
              .having((error) => error.code, 'code', 'internal')
              .having((error) => error.message, 'message', 'HTTP 400'),
        ),
      );
    },
  );

  test('unary posts the Connect envelope and the tenant header', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((request) async {
        sent = request;
        return http.Response('{}', 200);
      }),
    );

    await client.unary('/publira.v1.CatalogService/ListPublishedSeries', const {
      'limit': 20,
    }, tenantId: '  tenant-1  ');

    expect(
      sent.url.toString(),
      'https://example.test/publira.v1.CatalogService/ListPublishedSeries',
    );
    expect(sent.method, 'POST');
    expect(sent.headers['connect-protocol-version'], '1');
    expect(sent.headers['X-Publira-Tenant-Id'], 'tenant-1');
    expect(sent.headers.containsKey('authorization'), isFalse);
    expect(jsonDecode(sent.body), const {'limit': 20});
  });

  test('unary omits the tenant header when no tenant is given', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: MockClient((request) async {
        sent = request;
        return http.Response('{}', 200);
      }),
    );

    await client.unary(
      '/publira.v1.DomainService/GetTenantByDomain',
      const {},
      tenantId: '   ',
    );

    expect(sent.headers.containsKey('X-Publira-Tenant-Id'), isFalse);
  });

  test('unary reads the access token again on every call', () async {
    var token = '';
    final authorizations = <String?>[];
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      accessToken: () => token,
      httpClient: MockClient((request) async {
        authorizations.add(request.headers['authorization']);
        return http.Response('{}', 200);
      }),
    );

    await client.unary('/publira.v1.AuthService/GetMe', const {});
    token = '  member-token  ';
    await client.unary('/publira.v1.AuthService/GetMe', const {});

    expect(authorizations, [null, 'Bearer member-token']);
    expect(client.accessToken, 'member-token');
  });

  test('unary lets one call replace the token the client holds', () async {
    late http.Request sent;
    final client = ConnectClient(
      baseUrl: 'https://example.test',
      accessToken: () => 'stored-token',
      httpClient: MockClient((request) async {
        sent = request;
        return http.Response('{}', 200);
      }),
    );

    await client.unary(
      '/publira.v1.AuthService/GetMe',
      const {},
      accessToken: 'candidate-token',
    );

    expect(sent.headers['authorization'], 'Bearer candidate-token');
    expect(client.accessToken, 'stored-token');
  });
}
