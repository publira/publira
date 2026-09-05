import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';

const _tenantId = '018f0e6a-1000-7000-8000-000000000001';

TenantResolver _resolverOver(MockClient httpClient) {
  return TenantResolver(
    client: ConnectClient(
      baseUrl: 'https://example.test',
      httpClient: httpClient,
    ),
    tenantHost: 'localhost',
  );
}

void main() {
  test('resolve asks the domain service for the configured host', () async {
    late http.Request sent;
    final resolver = _resolverOver(
      MockClient((request) async {
        sent = request;
        return http.Response(jsonEncode(const {'tenantId': _tenantId}), 200);
      }),
    );

    expect(await resolver.resolve(), _tenantId);
    expect(sent.url.path, '/publira.v1.DomainService/GetTenantByDomain');
    expect(jsonDecode(sent.body), const {
      'domains': ['localhost'],
    });
  });

  test('a resolved tenant id is answered without asking again', () async {
    var lookups = 0;
    final resolver = _resolverOver(
      MockClient((_) async {
        lookups++;
        return http.Response(jsonEncode(const {'tenantId': _tenantId}), 200);
      }),
    );

    expect(await resolver.resolve(), _tenantId);
    expect(await resolver.resolve(), _tenantId);
    expect(lookups, 1);
  });

  test('callers waiting at the same time share one lookup', () async {
    final released = Completer<void>();
    var lookups = 0;
    final resolver = _resolverOver(
      MockClient((_) async {
        lookups++;
        await released.future;
        return http.Response(jsonEncode(const {'tenantId': _tenantId}), 200);
      }),
    );

    final first = resolver.resolve();
    final second = resolver.resolve();
    released.complete();

    expect(await first, _tenantId);
    expect(await second, _tenantId);
    expect(lookups, 1);
  });

  test('a failed lookup is not kept, so the next caller retries', () async {
    var lookups = 0;
    final resolver = _resolverOver(
      MockClient((_) async {
        lookups++;
        if (lookups == 1) {
          return http.Response(
            jsonEncode(const {'code': 'unavailable', 'message': 'down'}),
            503,
          );
        }
        return http.Response(jsonEncode(const {'tenantId': _tenantId}), 200);
      }),
    );

    await expectLater(
      resolver.resolve(),
      throwsA(
        isA<ConnectException>().having(
          (error) => error.code,
          'code',
          'unavailable',
        ),
      ),
    );
    expect(await resolver.resolve(), _tenantId);
    expect(lookups, 2);
  });

  test('an answer without a usable id fails as a Connect error', () async {
    for (final body in const <Map<String, Object?>>[
      {},
      {'tenantId': '   '},
      {'tenantId': 1},
    ]) {
      final resolver = _resolverOver(
        MockClient((_) async => http.Response(jsonEncode(body), 200)),
      );

      await expectLater(
        resolver.resolve(),
        throwsA(
          isA<ConnectException>().having(
            (error) => error.code,
            'code',
            'internal',
          ),
        ),
        reason: 'body $body',
      );
    }
  });

  test(
    'the default locale the tenant answers with is kept for the app',
    () async {
      final resolver = _resolverOver(
        MockClient(
          (_) async => http.Response(
            jsonEncode(const {'tenantId': _tenantId, 'defaultLocale': 'ja'}),
            200,
          ),
        ),
      );
      var notified = 0;
      resolver.defaultLocale.addListener(() => notified++);

      expect(resolver.defaultLocale.value, isNull);
      await resolver.resolve();

      expect(resolver.defaultLocale.value, 'ja');
      expect(notified, 1);
    },
  );

  test(
    'an answer naming no locale leaves the default locale unknown',
    () async {
      for (final body in const <Map<String, Object?>>[
        {'tenantId': _tenantId},
        {'tenantId': _tenantId, 'defaultLocale': '  '},
        {'tenantId': _tenantId, 'defaultLocale': 1},
      ]) {
        final resolver = _resolverOver(
          MockClient((_) async => http.Response(jsonEncode(body), 200)),
        );

        await resolver.resolve();

        expect(resolver.defaultLocale.value, isNull, reason: 'body $body');
      }
    },
  );
}
