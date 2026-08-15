import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpCatalogRepository catalog;

  setUp(() async {
    server = ConnectFixtureServer(
      series: ConnectFixtureServer.populatedSeries(),
      details: ConnectFixtureServer.populatedDetails(),
    );
    await server.start();
    catalog = HttpCatalogRepository(
      config: AppConfig(apiBaseUrl: server.baseUrl, tenantHost: 'localhost'),
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
}
