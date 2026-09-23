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

  test('a signed-out reader keeps the identifier the API hands over', () async {
    server.mintedAnonymousIdCookie =
        'publira_aid=${ConnectFixtureServer.mintedAnonymousId}; Path=/; '
        'HttpOnly; SameSite=Lax';

    await repository().record(ContentViewKind.series, seriesId);
    await repository().record(ContentViewKind.episode, episodeId);

    expect(anonymousIds.anonymousId, ConnectFixtureServer.mintedAnonymousId);
    final [first, second] = server.requestsTo('RecordContentView').toList();
    expect(first.headers[HttpHeaders.cookieHeader], isNull);
    expect(
      second.headers[HttpHeaders.cookieHeader],
      'publira_aid=${ConnectFixtureServer.mintedAnonymousId}',
    );
  });

  test('a Secure identifier is not kept over plain HTTP', () async {
    await repository().record(ContentViewKind.series, seriesId);

    expect(anonymousIds.anonymousId, isEmpty);
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

    test('reads empty before the API has handed one over', () async {
      final store = FileAnonymousIdStore(root: () async => root);

      expect(await store.read(), isEmpty);
    });

    test('keeps the identifier across instances', () async {
      await FileAnonymousIdStore(root: () async => root).write('aid-1');

      expect(
        await FileAnonymousIdStore(root: () async => root).read(),
        'aid-1',
      );
    });
  });
}
