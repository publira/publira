import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/v1/domain.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';

import 'support/proto_response.dart';

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
        return protoResponse(pb.GetTenantByDomainResponse(tenantId: _tenantId));
      }),
    );

    expect(await resolver.resolve(), _tenantId);
    expect(sent.url.path, '/rpc/publira.v1.DomainService/GetTenantByDomain');
    expect(
      pb.GetTenantByDomainRequest.fromBuffer(sent.bodyBytes),
      pb.GetTenantByDomainRequest(domains: ['localhost']),
    );
  });

  test('a resolved tenant id is answered without asking again', () async {
    var lookups = 0;
    final resolver = _resolverOver(
      MockClient((_) async {
        lookups++;
        return protoResponse(pb.GetTenantByDomainResponse(tenantId: _tenantId));
      }),
    );

    expect(await resolver.resolve(), _tenantId);
    expect(await resolver.resolve(), _tenantId);
    expect(lookups, 1);
  });

  test(
    'confirm asks the domain service again for a tenant already known',
    () async {
      var lookups = 0;
      final resolver = _resolverOver(
        MockClient((_) async {
          lookups++;
          return protoResponse(
            pb.GetTenantByDomainResponse(tenantId: _tenantId),
          );
        }),
      );

      await resolver.confirm();
      expect(lookups, 1);
      await resolver.confirm();
      expect(lookups, 2);
      expect(await resolver.resolve(), _tenantId);
      expect(lookups, 2);
    },
  );

  test('callers waiting at the same time share one lookup', () async {
    final released = Completer<void>();
    var lookups = 0;
    final resolver = _resolverOver(
      MockClient((_) async {
        lookups++;
        await released.future;
        return protoResponse(pb.GetTenantByDomainResponse(tenantId: _tenantId));
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
        return protoResponse(pb.GetTenantByDomainResponse(tenantId: _tenantId));
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
    for (final response in [
      pb.GetTenantByDomainResponse(),
      pb.GetTenantByDomainResponse(tenantId: '   '),
    ]) {
      final resolver = _resolverOver(
        MockClient((_) async => protoResponse(response)),
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
        reason: 'body $response',
      );
    }
  });

  test(
    'the default locale the tenant answers with is kept for the app',
    () async {
      final resolver = _resolverOver(
        MockClient(
          (_) async => protoResponse(
            pb.GetTenantByDomainResponse(
              tenantId: _tenantId,
              defaultLocale: 'ja',
            ),
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
      for (final response in [
        pb.GetTenantByDomainResponse(tenantId: _tenantId),
        pb.GetTenantByDomainResponse(tenantId: _tenantId, defaultLocale: '  '),
      ]) {
        final resolver = _resolverOver(
          MockClient((_) async => protoResponse(response)),
        );

        await resolver.resolve();

        expect(resolver.defaultLocale.value, isNull, reason: 'body $response');
      }
    },
  );

  test('the locales the tenant offers are kept for the app', () async {
    final resolver = _resolverOver(
      MockClient(
        (_) async => protoResponse(
          pb.GetTenantByDomainResponse(
            tenantId: _tenantId,
            defaultLocale: 'ja',
            supportedLocales: ['ja', 'en'],
          ),
        ),
      ),
    );
    var notified = 0;
    resolver.supportedLocales.addListener(() => notified++);

    expect(resolver.supportedLocales.value, isNull);
    await resolver.resolve();

    expect(resolver.supportedLocales.value, ['ja', 'en']);
    expect(notified, 1);

    await resolver.confirm();

    expect(resolver.supportedLocales.value, ['ja', 'en']);
    expect(notified, 1, reason: 'the same set answered again');
  });

  test(
    'an answer naming no locale leaves the offered locales unknown',
    () async {
      for (final response in [
        pb.GetTenantByDomainResponse(tenantId: _tenantId),
        pb.GetTenantByDomainResponse(
          tenantId: _tenantId,
          supportedLocales: ['  '],
        ),
      ]) {
        final resolver = _resolverOver(
          MockClient((_) async => protoResponse(response)),
        );

        await resolver.resolve();

        expect(
          resolver.supportedLocales.value,
          isNull,
          reason: 'body $response',
        );
      }
    },
  );
}
