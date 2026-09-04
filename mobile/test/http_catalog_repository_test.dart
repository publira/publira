import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_detail.dart';

import 'support/connect_fixture_server.dart';

const imageBaseUrl = 'http://images.test';

void main() {
  late ConnectFixtureServer server;
  late HttpCatalogRepository catalog;

  setUp(() async {
    server = ConnectFixtureServer(
      series: ConnectFixtureServer.populatedSeries(),
      details: ConnectFixtureServer.populatedDetails(),
      episodes: ConnectFixtureServer.populatedEpisodes(),
      entitledEpisodes: ConnectFixtureServer.populatedEntitledEpisodes(),
    );
    await server.start();
    catalog = HttpCatalogRepository(
      config: AppConfig(
        apiBaseUrl: server.baseUrl,
        tenantHost: 'localhost',
        imageBaseUrl: imageBaseUrl,
      ),
    );
  });

  tearDown(() async {
    await server.close();
  });

  test('listSeries maps public API series onto SeriesItem', () async {
    final items = await catalog.listSeries();
    expect(items, isNotEmpty);
    expect(items.first.id, ConnectFixtureServer.seedSeriesId);
    expect(items.first.title, ConnectFixtureServer.seedSeriesTitle);
    expect(items.first.description, ConnectFixtureServer.seedSeriesSynopsis);
    expect(items.first.labelName, 'Seed Label 01');
  });

  test('listSeries returns an empty list when the API has no series', () async {
    server.series = const [];
    expect(await catalog.listSeries(), isEmpty);
  });

  test('listSeries accepts an omitted empty repeated field', () async {
    server.listResponse = const <String, Object?>{};
    expect(await catalog.listSeries(), isEmpty);
  });

  test('getSeries returns detail and episode count', () async {
    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);
    expect(detail, isNotNull);
    expect(detail!.series.title, ConnectFixtureServer.seedSeriesTitle);
    expect(detail.series.episodeCount, 2);
    expect(detail.episodes.first.title, ConnectFixtureServer.seedEpisodeTitle);
    expect(detail.episodes.last.price, 500);
  });

  test('getSeries returns null for a missing public id', () async {
    expect(await catalog.getSeries('ZZZZZZZZZZZZ'), isNull);
  });

  test('listSeries maps transport failure to CatalogFailure.network', () async {
    server.listStatus = HttpStatus.serviceUnavailable;
    expect(
      () => catalog.listSeries(),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );
  });

  test('listSeries rejects a malformed success response', () async {
    server.listResponse = const {'series': 'not a list'};

    expect(
      () => catalog.listSeries(),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getSeries rejects a detail without a public id', () async {
    server.detailResponse = const {
      'series': {'title': 'Missing public id'},
      'episodes': <Object?>[],
    };

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getEpisode maps a free body onto reader pages', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail, isNotNull);
    expect(detail!.access, EpisodeAccess.free);
    expect(detail.episode.title, ConnectFixtureServer.seedEpisodeTitle);
    expect(detail.seriesTitle, ConnectFixtureServer.seedSeriesTitle);
    expect(detail.images, hasLength(ConnectFixtureServer.seedEpisodePageCount));
    expect(detail.images.first.width, 800);
    expect(detail.images.first.height, 1200);
  });

  test('getEpisode resolves image paths against the image base url', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    // The free body's own media token is part of the reference, not decoration
    // on it: it is what a signed-out reader decrypts the page with.
    expect(
      detail!.images.first.url.toString(),
      '$imageBaseUrl/images/episodes/${ConnectFixtureServer.seedEpisodeId}-page-1'
      '?t=${ConnectFixtureServer.freeEpisodeMediaToken}',
    );
  });

  test('getEpisode keeps the media token the API attached', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Paid', 'price': 500},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_ENTITLED',
      'images': [
        {'id': 'page-1', 'imageUrl': '/images/episodes/page-1?t=token-value'},
      ],
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.entitled);
    expect(detail.images.single.url.queryParameters['t'], 'token-value');
  });

  test('getEpisode orders pages by displayOrder', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Shuffled'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_FREE',
      'images': [
        {'id': 'b', 'imageUrl': '/images/episodes/b', 'displayOrder': 2},
        {'id': 'a', 'imageUrl': '/images/episodes/a', 'displayOrder': 1},
      ],
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.images.map((image) => image.id), ['a', 'b']);
  });

  test('getEpisode reports a locked paid body with no pages', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.locked);
    expect(detail.images, isEmpty);
  });

  test('getEpisode returns null for a missing public id', () async {
    expect(
      await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        'ZZZZZZZZZZZZ',
      ),
      isNull,
    );
  });

  test(
    'getEpisode returns null when the episode is under another series',
    () async {
      expect(
        await catalog.getEpisode(
          'series-kitchen',
          ConnectFixtureServer.seedEpisodeId,
        ),
        isNull,
      );
    },
  );

  test('getEpisode maps transport failure to CatalogFailure.network', () async {
    server.episodeStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      ),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );
  });

  test(
    'a tenant lookup answering with a non-string id is unexpected',
    () async {
      server.tenantResponse = const {'tenantId': 1};

      expect(
        catalog.listSeries(),
        throwsA(
          isA<CatalogFailure>().having(
            (error) => error.kind,
            'kind',
            CatalogFailureKind.unexpected,
          ),
        ),
      );
    },
  );

  test('getEpisode carries the tenant host on the image request', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.imageRequestHeaders['x-forwarded-host'], 'localhost');
    expect(detail.imageRequestHeaders.containsKey('authorization'), isFalse);
  });

  test('an access token reaches both the API and image-server', () async {
    var accessToken = '';
    final config = AppConfig(
      apiBaseUrl: server.baseUrl,
      tenantHost: 'localhost',
      imageBaseUrl: imageBaseUrl,
    );
    final authenticated = HttpCatalogRepository(
      config: config,
      client: ConnectClient(
        baseUrl: server.baseUrl,
        accessToken: () => accessToken,
      ),
    );

    final anonymous = await authenticated.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
    );
    expect(anonymous!.access, EpisodeAccess.locked);
    expect(anonymous.imageRequestHeaders.containsKey('authorization'), isFalse);

    accessToken = ConnectFixtureServer.memberAccessToken;
    final entitled = await authenticated.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
    );

    expect(entitled!.access, EpisodeAccess.entitled);
    expect(entitled.images, isNotEmpty);
    expect(
      entitled.imageRequestHeaders['authorization'],
      'Bearer ${ConnectFixtureServer.memberAccessToken}',
    );
  });

  test(
    'the tenant is resolved once and reused by the reads after it',
    () async {
      await catalog.listSeries();
      await catalog.getSeries(ConnectFixtureServer.seedSeriesId);
      await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      );

      expect(server.requestsTo('GetTenantByDomain'), hasLength(1));
    },
  );

  test('every read carries the resolved tenant in header and body', () async {
    await catalog.listSeries();
    await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    final list = server.requestsTo('ListPublishedSeries').single;
    expect(
      list.headers['x-publira-tenant-id'],
      ConnectFixtureServer.defaultTenantId,
    );
    expect(list.body['limit'], 20);
    expect(list.body['tenant'], {
      'tenantId': ConnectFixtureServer.defaultTenantId,
    });

    final detail = server.requestsTo('GetSeriesDetail').single;
    expect(
      detail.headers['x-publira-tenant-id'],
      ConnectFixtureServer.defaultTenantId,
    );
    expect(detail.body['publicId'], ConnectFixtureServer.seedSeriesId);
    expect(detail.body['tenant'], {
      'tenantId': ConnectFixtureServer.defaultTenantId,
    });
  });

  test('a failed tenant lookup is retried by the next read', () async {
    server.tenantStatus = HttpStatus.serviceUnavailable;
    server.tenantResponse = const {
      'code': 'unavailable',
      'message': 'domain service is down',
    };

    await expectLater(
      catalog.listSeries(),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );

    server.tenantStatus = HttpStatus.ok;
    server.tenantResponse = null;

    expect(await catalog.listSeries(), isNotEmpty);
    expect(server.requestsTo('GetTenantByDomain'), hasLength(2));
  });

  test('listSeries maps a Connect internal error to unexpected', () async {
    server.listStatus = HttpStatus.internalServerError;
    server.listResponse = const {'code': 'internal', 'message': 'boom'};

    expect(
      () => catalog.listSeries(),
      throwsA(
        isA<CatalogFailure>()
            .having(
              (error) => error.kind,
              'kind',
              CatalogFailureKind.unexpected,
            )
            .having((error) => error.message, 'message', 'boom'),
      ),
    );
  });

  test('listSeries maps a timed-out request to network', () async {
    const config = AppConfig(
      apiBaseUrl: 'https://example.test',
      tenantHost: 'localhost',
      imageBaseUrl: imageBaseUrl,
    );
    final unresponsive = HttpCatalogRepository(
      config: config,
      client: ConnectClient(
        baseUrl: config.apiBaseUrl,
        timeout: const Duration(milliseconds: 20),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/GetTenantByDomain')) {
            return http.Response(
              jsonEncode(const {
                'tenantId': ConnectFixtureServer.defaultTenantId,
              }),
              200,
            );
          }
          await Future<void>.delayed(const Duration(seconds: 1));
          return http.Response('{}', 200);
        }),
      ),
    );

    await expectLater(
      unresponsive.listSeries(),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );
  });

  test('getSeries returns null when the reader may not see it', () async {
    server.detailStatus = HttpStatus.forbidden;
    server.detailResponse = const {
      'code': 'permission_denied',
      'message': 'series is not readable here',
    };

    expect(await catalog.getSeries(ConnectFixtureServer.seedSeriesId), isNull);
  });

  test('getEpisode returns null when the reader may not see it', () async {
    server.episodeStatus = HttpStatus.forbidden;
    server.episodeResponse = const {
      'code': 'permission_denied',
      'message': 'episode is not readable here',
    };

    expect(
      await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      ),
      isNull,
    );
  });

  test('listSeries reads a series without a label as unlabelled', () async {
    final items = await catalog.listSeries();
    expect(items.last.labelName, isEmpty);
  });

  test('listSeries rejects a series with a blank public id', () async {
    server.series = [
      {'publicId': '   ', 'title': 'Blank public id'},
    ];

    expect(
      () => catalog.listSeries(),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getSeries orders episodes by orderIndex', () async {
    server.detailResponse = {
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'episodes': [
        {'publicId': 'EP10', 'title': 'Tenth', 'orderIndex': 10, 'price': 500},
        {'publicId': 'EP01', 'title': 'First', 'orderIndex': 1, 'price': 0},
      ],
    };

    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    expect(detail!.episodes.map((episode) => episode.id), ['EP01', 'EP10']);
    expect(detail.series.episodeCount, 2);
  });

  test('getSeries reads omitted numbers as zero', () async {
    // protojson omits a zero, so an episode that is first and free arrives
    // without `orderIndex` and without `price`.
    server.detailResponse = {
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'episodes': [
        {'publicId': 'EP01', 'title': 'First'},
      ],
    };

    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    expect(detail!.episodes.single.orderIndex, 0);
    expect(detail.episodes.single.price, 0);
  });

  test('getSeries rejects a non-integer orderIndex', () async {
    server.detailResponse = {
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'episodes': [
        {'publicId': 'EP01', 'title': 'First', 'orderIndex': '1'},
      ],
    };

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getSeries rejects an episode without a public id', () async {
    server.detailResponse = {
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'episodes': [
        {'title': 'No public id'},
      ],
    };

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getSeries rejects an episodes field that is not a list', () async {
    server.detailResponse = {
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'episodes': 'not a list',
    };

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getEpisode reports an access value this build does not know', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Newly gated'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_SUBSCRIBED',
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.unknown);
    expect(detail.images, isEmpty);
  });

  test('getEpisode reads an omitted access as unknown', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'No access field'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.unknown);
  });

  test('getEpisode reads omitted page sizes as zero', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Sizeless pages'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_FREE',
      'images': [
        {'id': 'a', 'imageUrl': '/images/episodes/a'},
      ],
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.images.single.width, 0);
    expect(detail.images.single.height, 0);
    expect(detail.images.single.displayOrder, 0);
  });

  test('getEpisode rejects a page without an image url', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Unreachable page'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_FREE',
      'images': [
        {'id': 'a'},
      ],
    };

    expect(
      () => catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      ),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getEpisode rejects a body without a series', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Orphan'},
      'access': 'EPISODE_ACCESS_FREE',
    };

    expect(
      () => catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      ),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });
}
