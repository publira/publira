import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/content_views/anonymous_id_store.dart';
import 'package:publira/content_views/content_view_repository.dart';
import 'package:publira/content_views/http_content_view_repository.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const seriesId = ConnectFixtureServer.seedSeriesId;
  const episodeId = 'SeedEPSDAAA1';

  late ConnectFixtureServer server;
  late String accessToken;
  late MemoryAnonymousIdStore anonymousIds;
  final now = DateTime.utc(2026, 9, 23, 12);

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpContentViewRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpContentViewRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
      anonymousIds: anonymousIds,
      now: () => now,
    );
  }

  setUp(() async {
    accessToken = '';
    anonymousIds = MemoryAnonymousIdStore();
    server = ConnectFixtureServer();
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('a series view names the series, the tenant, and the app', () async {
    await repository().record(ContentViewKind.series, seriesId);

    final request = server.requestsTo('RecordContentView').single;
    expect(request.body, {
      'tenant': {'tenantId': server.tenantId},
      'target': {
        'type': 'CONTENT_VIEW_TARGET_TYPE_SERIES',
        'publicId': seriesId,
      },
      'surface': 'CLIENT_SURFACE_APP',
    });
    expect(request.headers['x-publira-tenant-id'], server.tenantId);
  });

  test('an episode view names the episode', () async {
    await repository().record(ContentViewKind.episode, episodeId);

    final request = server.requestsTo('RecordContentView').single;
    expect(request.body['target'], {
      'type': 'CONTENT_VIEW_TARGET_TYPE_EPISODE',
      'publicId': episodeId,
    });
  });

  test('a signed-in reader is attributed by the session', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().record(ContentViewKind.series, seriesId);

    final request = server.requestsTo('RecordContentView').single;
    expect(request.headers['authorization'], 'Bearer $accessToken');
    expect(request.headers[HttpHeaders.cookieHeader], isNull);
  });

  /// The cookie the API mints, without the Secure attribute a plain HTTP
  /// fixture could not hand over.
  const plainCookie =
      'publira_aid=${ConnectFixtureServer.mintedAnonymousId}; Path=/; '
      'Max-Age=15552000; HttpOnly; SameSite=Lax';

  test('a signed-out reader keeps the identifier the API hands over', () async {
    server.mintedAnonymousIdCookie = plainCookie;

    await repository().record(ContentViewKind.series, seriesId);
    await repository().record(ContentViewKind.episode, episodeId);

    expect(
      anonymousIds.anonymousId?.value,
      ConnectFixtureServer.mintedAnonymousId,
    );
    expect(
      anonymousIds.anonymousId?.expiresAt,
      now.add(const Duration(days: 180)),
    );
    final [first, second] = server.requestsTo('RecordContentView').toList();
    expect(first.headers[HttpHeaders.cookieHeader], isNull);
    expect(
      second.headers[HttpHeaders.cookieHeader],
      'publira_aid=${ConnectFixtureServer.mintedAnonymousId}',
    );
  });

  test(
    'a view sent while the first is minted carries its identifier',
    () async {
      server.mintedAnonymousIdCookie = plainCookie;
      final views = repository();

      await Future.wait([
        views.record(ContentViewKind.series, seriesId),
        views.record(ContentViewKind.episode, episodeId),
      ]);

      final [first, second] = server.requestsTo('RecordContentView').toList();
      expect(first.headers[HttpHeaders.cookieHeader], isNull);
      expect(
        second.headers[HttpHeaders.cookieHeader],
        'publira_aid=${ConnectFixtureServer.mintedAnonymousId}',
      );
    },
  );

  test('a view after a failed one is still sent', () async {
    server.contentViewStatus = HttpStatus.serviceUnavailable;
    final views = repository();
    await expectLater(
      views.record(ContentViewKind.series, seriesId),
      throwsA(isA<ConnectException>()),
    );
    server.contentViewStatus = HttpStatus.ok;
    await views.record(ContentViewKind.episode, episodeId);

    expect(server.requestsTo('RecordContentView'), hasLength(2));
  });

  test('an identifier past its expiry is not sent', () async {
    anonymousIds.anonymousId = AnonymousId(
      value: 'expired-id',
      expiresAt: now.subtract(const Duration(seconds: 1)),
    );

    await repository().record(ContentViewKind.series, seriesId);

    final request = server.requestsTo('RecordContentView').single;
    expect(request.headers[HttpHeaders.cookieHeader], isNull);
  });

  test('a cookie without an expiry is not kept', () async {
    server.mintedAnonymousIdCookie =
        'publira_aid=${ConnectFixtureServer.mintedAnonymousId}; Path=/';

    await repository().record(ContentViewKind.series, seriesId);

    expect(anonymousIds.anonymousId, isNull);
  });

  test('a Secure identifier is not kept over plain HTTP', () async {
    await repository().record(ContentViewKind.series, seriesId);

    expect(anonymousIds.anonymousId, isNull);
  });

  test('a view the API could not take reaches the caller', () async {
    server.contentViewStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().record(ContentViewKind.series, seriesId),
      throwsA(isA<ConnectException>()),
    );
  });

  group('the anonymous identifier file', () {
    late Directory root;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('anonymous-id');
    });

    tearDown(() async {
      await root.delete(recursive: true);
    });

    test('reads nothing before the API has handed one over', () async {
      final store = FileAnonymousIdStore(root: () async => root);

      expect(await store.read(), isNull);
    });

    test('keeps the identifier and its expiry across instances', () async {
      final expiresAt = DateTime.utc(2027, 3, 22, 12);
      await FileAnonymousIdStore(
        root: () async => root,
      ).write(AnonymousId(value: 'aid-1', expiresAt: expiresAt));

      final read = await FileAnonymousIdStore(root: () async => root).read();

      expect(read?.value, 'aid-1');
      expect(read?.expiresAt, expiresAt);
    });

    test('reads nothing from a file it cannot parse', () async {
      await File('${root.path}/anonymous-id.json').writeAsString('aid-1');

      expect(await FileAnonymousIdStore(root: () async => root).read(), isNull);
    });
  });
}
