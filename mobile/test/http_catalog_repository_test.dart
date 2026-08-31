import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
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

    expect(
      detail!.images.first.url.toString(),
      '$imageBaseUrl/images/episodes/${ConnectFixtureServer.seedEpisodeId}-page-1',
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
}
