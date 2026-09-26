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
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpCatalogRepository catalog;

  setUp(() async {
    server = ConnectFixtureServer(
      series: ConnectFixtureServer.populatedSeries(),
      rankedSeries: ConnectFixtureServer.populatedRankedSeries(),
      details: ConnectFixtureServer.populatedDetails(),
      episodes: ConnectFixtureServer.populatedEpisodes(),
      entitledEpisodes: ConnectFixtureServer.populatedEntitledEpisodes(),
    );
    await server.start();
    catalog = HttpCatalogRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  test('listSeries maps public API series onto SeriesItem', () async {
    final items = (await catalog.listSeries()).series;
    expect(items, isNotEmpty);
    expect(items.first.id, ConnectFixtureServer.seedSeriesId);
    expect(items.first.title, ConnectFixtureServer.seedSeriesTitle);
    expect(items.first.description, ConnectFixtureServer.seedSeriesSynopsis);
    expect(items.first.labelName, 'Seed Label 01');
  });

  test(
    'listSeries rejects an aggregate rating above the score ceiling',
    () async {
      server.series = [
        {...ConnectFixtureServer.populatedSeries().first, 'ratingAverage': 6},
      ];

      expect(
        catalog.listSeries,
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

  test('listSeries asks for the catalog by title', () async {
    await catalog.listSeries();

    final request = server.requestsTo('ListPublishedSeries').single;
    expect(request.body['order'], 'SERIES_ORDER_TITLE_ASC');
    expect(request.body['limit'], 20);
    // protojson omits a default, and an omitted token is the first page.
    expect(request.body.containsKey('token'), isFalse);
  });

  test('listSeries carries the token of the page under the first', () async {
    server.seriesPageSize = 1;

    final first = await catalog.listSeries();

    expect(first.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(first.nextToken, isNotEmpty);
  });

  test('listSeries asks for the page its token names', () async {
    server.seriesPageSize = 1;
    final first = await catalog.listSeries();

    final second = await catalog.listSeries(token: first.nextToken);

    expect(second.series.single.id, 'series-kitchen');
    expect(
      server.requestsTo('ListPublishedSeries').last.body['token'],
      first.nextToken,
    );
    // The order travels with every page: a token is only good for the list it
    // was cut from.
    expect(
      server.requestsTo('ListPublishedSeries').last.body['order'],
      'SERIES_ORDER_TITLE_ASC',
    );
  });

  test('listSeries reads the last page as the end of the catalog', () async {
    server.seriesPageSize = 1;
    final first = await catalog.listSeries();

    final last = await catalog.listSeries(token: first.nextToken);

    expect(last.nextToken, isEmpty);
  });

  test('listSeries reads a catalog of one page as ending there', () async {
    expect((await catalog.listSeries()).nextToken, isEmpty);
  });

  test('searchSeries maps the matching series onto SeriesItem', () async {
    final page = await catalog.searchSeries(query: 'Kitchen');

    expect(page.series.single.id, 'series-kitchen');
    expect(page.series.single.title, 'The Little Kitchen');
  });

  test('searchSeries asks for the keyword the reader typed', () async {
    await catalog.searchSeries(query: 'Kitchen');

    final request = server.requestsTo('SearchPublishedSeries').single;
    expect(request.body['query'], 'Kitchen');
    expect(request.body['limit'], 20);
    // protojson omits a default, and an omitted token is the first page.
    expect(request.body.containsKey('token'), isFalse);
  });

  test('searchSeries asks for the page its token names', () async {
    server.seriesPageSize = 1;
    server.series = [
      ...ConnectFixtureServer.populatedSeries(),
      {'publicId': 'series-second-kitchen', 'title': 'Kitchen Nights'},
    ];

    final first = await catalog.searchSeries(query: 'Kitchen');

    // The results are in title order, so `Kitchen Nights` stands above
    // `The Little Kitchen` however the tenant published them.
    expect(first.series.single.id, 'series-second-kitchen');
    expect(first.nextToken, isNotEmpty);

    final second = await catalog.searchSeries(
      query: 'Kitchen',
      token: first.nextToken,
    );

    expect(second.series.single.id, 'series-kitchen');
    expect(second.nextToken, isEmpty);
    final request = server.requestsTo('SearchPublishedSeries').last;
    expect(request.body['token'], first.nextToken);
    // The token belongs to the keyword it was built for, so it travels with
    // the same query rather than on its own.
    expect(request.body['query'], 'Kitchen');
  });

  test('searchSeries reads a keyword nothing matches as empty', () async {
    final page = await catalog.searchSeries(query: 'nothing here');

    expect(page.series, isEmpty);
    expect(page.nextToken, isEmpty);
  });

  test('a search the API could not answer is a network failure', () async {
    server.searchStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.searchSeries(query: 'Kitchen'),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );
  });

  test('listNewestSeries asks for one short page of the newest', () async {
    final items = await catalog.listNewestSeries(limit: 10);

    expect(items.first.id, ConnectFixtureServer.seedSeriesId);
    final request = server.requestsTo('ListPublishedSeries').single;
    expect(request.body['order'], 'SERIES_ORDER_PUBLISHED_AT_DESC');
    expect(request.body['limit'], 10);
  });

  test('listRankedSeries maps a snapshot onto its positions', () async {
    final ranked = await catalog.listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
    );

    expect(ranked, hasLength(2));
    expect(ranked.first.rank, 1);
    expect(ranked.first.series.id, ConnectFixtureServer.seedSeriesId);
    expect(ranked.first.series.eyeCatchVariants, isNotEmpty);
    // A snapshot keeps the positions it recorded, so a series unpublished
    // since leaves the gap it was in.
    expect(ranked.last.rank, 3);

    final request = server.requestsTo('ListRankedSeries').single;
    expect(request.body['period'], 'RANKING_PERIOD_WEEKLY');
    expect(request.body['limit'], 10);
  });

  test('listRankedSeries names the day the daily chart asks for', () async {
    await catalog.listRankedSeries(limit: 3, period: RankingPeriod.daily);

    expect(
      server.requestsTo('ListRankedSeries').single.body['period'],
      'RANKING_PERIOD_DAILY',
    );
  });

  test('a tenant with no snapshot reads as an empty chart', () async {
    server.rankedSeries = const [];

    expect(
      await catalog.listRankedSeries(limit: 10, period: RankingPeriod.weekly),
      isEmpty,
    );
  });

  test('a ranking the API could not answer is a failure', () async {
    server.rankedStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.listRankedSeries(limit: 10, period: RankingPeriod.weekly),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.network,
        ),
      ),
    );
  });

  test('listSeries resolves cover renditions against the image base', () async {
    final items = (await catalog.listSeries()).series;

    final covers = items.first.eyeCatchVariants;
    expect(covers, hasLength(5));
    expect(
      covers.first.url.toString(),
      '${server.baseUrl}/images/series/'
      '${ConnectFixtureServer.seedSeriesImageId}/portrait/400',
    );
    expect(covers.first.variantType, 'portrait');
    expect(covers.first.width, 400);
    expect(covers.first.height, 533);
  });

  test('a cover is requested with the tenant and no reader token', () async {
    final items = (await catalog.listSeries()).series;

    // An eye-catch is the same image for every reader, so the request that
    // fetches it names only the tenant.
    expect(items.first.imageRequestHeaders, {'x-forwarded-host': 'localhost'});
  });

  test('listSeries reads a series without a cover as carrying none', () async {
    final items = (await catalog.listSeries()).series;

    expect(items.last.eyeCatchVariants, isEmpty);
  });

  test(
    'listSeries carries the credits in the order the API sent them',
    () async {
      final items = (await catalog.listSeries()).series;

      final creators = items.first.creators;
      expect(creators.map((creator) => creator.name), [
        'Seed Author 001',
        'Seed Author 002',
        'Seed Author 003',
      ]);
      expect(creators.first.id, 'SeedAUTHAAA1');
      expect(creators.map((creator) => creator.roleName), [
        'Story',
        'Art',
        'Art',
      ]);
    },
  );

  test('listSeries reads a credit with no role as carrying none', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'creators': [
          {'publicId': 'SeedAUTHAAA1', 'name': 'Seed Author 001'},
        ],
      },
    ];

    final items = (await catalog.listSeries()).series;

    expect(items.first.creators.single.roleName, isEmpty);
  });

  test(
    'listSeries reads a series credited to nobody as carrying none',
    () async {
      final items = (await catalog.listSeries()).series;

      expect(items.last.creators, isEmpty);
    },
  );

  test('listSeries drops a credit with no name', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'creators': [
          {'publicId': 'SeedAUTHAAA1', 'name': ''},
          {'publicId': 'SeedAUTHAAA2', 'name': 'Seed Author 002'},
        ],
      },
    ];

    final items = (await catalog.listSeries()).series;

    expect(items.first.creators.map((creator) => creator.name), [
      'Seed Author 002',
    ]);
  });

  test('listSeries rejects a credits field that is not a list', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'creators': 'not a list',
      },
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

  test('getSeries carries the credits of the series', () async {
    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    expect(detail!.series.creators.map((creator) => creator.name), [
      'Seed Author 001',
      'Seed Author 002',
      'Seed Author 003',
    ]);
  });

  test('listSeries carries status, schedule, and genres', () async {
    final items = (await catalog.listSeries()).series;

    expect(items.first.status, SeriesStatus.ongoing);
    expect(items.first.scheduleWeekdays, [1, 4]);
    expect(items.first.genres.single.name, 'Fantasy');
    expect(items.first.genres.single.id, 'SeedGENRAAA1');
    expect(items.first.ageRating, isNull);
    expect(items.last.status, isNull);
    expect(items.last.genres, isEmpty);
  });

  test('listSeries carries the tags of a series', () async {
    final items = (await catalog.listSeries()).series;

    expect(items.first.tags.single.slug, 'time-travel');
    expect(items.first.tags.single.name, 'Time travel');
    expect(items.last.tags, isEmpty);
  });

  test('listSeries drops a tag with no slug or no name', () async {
    server.series = [
      {
        ...ConnectFixtureServer.populatedSeries().first,
        'tags': [
          {'name': 'Nameless slug', 'slug': ''},
          {'name': '', 'slug': 'no-name'},
          {'name': 'Slow burn', 'slug': 'slow-burn'},
        ],
      },
    ];

    final tags = (await catalog.listSeries()).series.single.tags;

    expect(tags.single.slug, 'slow-burn');
  });

  test('getSeries carries the classification of the series', () async {
    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    expect(detail!.series.status, SeriesStatus.ongoing);
    expect(detail.series.scheduleWeekdays, [1, 4]);
    expect(detail.series.genres.single.name, 'Fantasy');
  });

  test('listSeries maps a restricted age rating', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'ageRating': 'SERIES_AGE_RATING_R15',
      },
    ];

    final items = (await catalog.listSeries()).series;

    expect(items.single.ageRating, SeriesAgeRating.r15);
  });

  test('listSeries maps an unrecognized age rating as unknown', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'ageRating': 'SERIES_AGE_RATING_R20',
      },
    ];

    final items = (await catalog.listSeries()).series;

    expect(items.single.ageRating, SeriesAgeRating.unknown);
  });

  test('listSeries drops a genre with no name or public id', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'genres': [
          {'publicId': '', 'name': 'Fantasy'},
          {'publicId': 'SeedGENRAAA2', 'name': ''},
          {'publicId': 'SeedGENRAAA1', 'name': 'Fantasy'},
        ],
      },
    ];

    final items = (await catalog.listSeries()).series;

    expect(items.single.genres.single.name, 'Fantasy');
    expect(items.single.genres.single.id, 'SeedGENRAAA1');
  });

  test(
    'listSeries drops a weekday that is not Sunday through Saturday',
    () async {
      server.series = [
        {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
          'scheduleWeekdays': [1, 9, 4],
        },
      ];

      final items = (await catalog.listSeries()).series;

      expect(items.single.scheduleWeekdays, [1, 4]);
    },
  );

  test('getEpisode carries the series age rating', () async {
    server.episodes = {
      ConnectFixtureServer.seedEpisodeId: {
        'episode': {
          'publicId': ConnectFixtureServer.seedEpisodeId,
          'title': ConnectFixtureServer.seedEpisodeTitle,
          'orderIndex': 1,
          'price': 0,
        },
        'series': {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
          'ageRating': 'SERIES_AGE_RATING_R18',
        },
        'access': 'EPISODE_ACCESS_FREE',
        'images': const <Object?>[],
      },
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.ageRating, SeriesAgeRating.r18);
  });

  test('getSeries carries the cover renditions of the series', () async {
    final detail = await catalog.getSeries(ConnectFixtureServer.seedSeriesId);

    expect(detail!.series.eyeCatchVariants, hasLength(5));
    expect(detail.series.imageRequestHeaders, {
      'x-forwarded-host': 'localhost',
    });
  });

  test('listSeries rejects a cover rendition without a url', () async {
    server.series = [
      {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
        'eyeCatchImageVariants': [
          {'variantType': 'portrait', 'width': 400, 'height': 533},
        ],
      },
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

  test('listSeries returns an empty list when the API has no series', () async {
    server.series = const [];
    expect((await catalog.listSeries()).series, isEmpty);
  });

  test('listSeries accepts an omitted empty repeated field', () async {
    server.listResponse = const <String, Object?>{};
    expect((await catalog.listSeries()).series, isEmpty);
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

  test('getSeriesTitle names the series a follow row stands for', () async {
    expect(
      await catalog.getSeriesTitle(ConnectFixtureServer.seedSeriesId),
      ConnectFixtureServer.seedSeriesTitle,
    );
  });

  test('getSeriesTitle returns null for a series nothing publishes', () async {
    expect(await catalog.getSeriesTitle('ZZZZZZZZZZZZ'), isNull);
  });

  test('getCreator names the author a follow row stands for', () async {
    final creator = await catalog.getCreator('SeedAUTHAAA1');

    expect(creator, isNotNull);
    expect(creator!.id, 'SeedAUTHAAA1');
    expect(creator.name, 'Seed Author 001');
  });

  test('getCreator returns null for an author nothing publishes', () async {
    expect(await catalog.getCreator('ZZZZZZZZZZZZ'), isNull);
  });

  test(
    'searchCreators maps the matching authors onto PublishedCreator',
    () async {
      final page = await catalog.searchCreators(query: 'author 002');

      final creator = page.creators.single;
      expect(creator.id, 'SeedAUTHAAA2');
      expect(creator.name, 'Seed Author 002');
      expect(creator.profileText, 'Profile text for Seed Author 002');
      expect(creator.seriesCount, 1);
      expect(page.nextToken, isEmpty);

      final request = server.requestsTo('SearchPublishedCreators').single;
      expect(request.body['query'], 'author 002');
      expect(request.body['limit'], 20);
      expect(request.body.containsKey('token'), isFalse);
    },
  );

  test('searchCreators asks for the page its token names', () async {
    server.seriesPageSize = 2;

    final first = await catalog.searchCreators(query: 'Seed Author');

    expect(first.creators.map((creator) => creator.id), [
      'SeedAUTHAAA1',
      'SeedAUTHAAA2',
    ]);

    final second = await catalog.searchCreators(
      query: 'Seed Author',
      token: first.nextToken,
    );

    expect(second.creators.single.id, 'SeedAUTHAAA3');
    expect(second.nextToken, isEmpty);
    final request = server.requestsTo('SearchPublishedCreators').last;
    expect(request.body['token'], first.nextToken);
    expect(request.body['query'], 'Seed Author');
  });

  test('searchCreators resolves a portrait against the image base', () async {
    server.series = [
      {
        'publicId': 'series-portrait',
        'title': 'Portrait',
        'creators': [
          {
            'publicId': 'author-portrait',
            'name': 'Portrait Author',
            'iconImageUrl': '/images/creators/portrait',
          },
        ],
      },
    ];
    final page = await catalog.searchCreators(query: 'Portrait');

    final creator = page.creators.single;
    expect(
      creator.iconUrl.toString(),
      '${server.baseUrl}/images/creators/portrait',
    );
    // A portrait is served to every reader alike, so only the tenant travels.
    expect(creator.imageRequestHeaders.containsKey('authorization'), isFalse);
  });

  test('searchCreators reads a keyword nothing matches as empty', () async {
    final page = await catalog.searchCreators(query: 'nothing here');

    expect(page.creators, isEmpty);
    expect(page.nextToken, isEmpty);
  });

  test('searchLabels maps the matching labels onto PublishedLabel', () async {
    final page = await catalog.searchLabels(query: 'label 01');

    final label = page.labels.single;
    expect(label.id, 'SeedLABLAAA1');
    expect(label.name, 'Seed Label 01');
    // `Label` answers without a count, which is not a count of zero.
    expect(label.seriesCount, isNull);
    expect(
      server.requestsTo('SearchPublishedLabels').single.body['query'],
      'label 01',
    );
  });

  test('a creator or label search the API could not answer is a network '
      'failure', () async {
    server.searchStatus = HttpStatus.serviceUnavailable;
    final isNetwork = throwsA(
      isA<CatalogFailure>().having(
        (error) => error.kind,
        'kind',
        CatalogFailureKind.network,
      ),
    );

    expect(() => catalog.searchCreators(query: 'Seed'), isNetwork);
    expect(() => catalog.searchLabels(query: 'Seed'), isNetwork);
  });

  test('getCreatorDetail carries the author and their series', () async {
    final detail = await catalog.getCreatorDetail('SeedAUTHAAA1');

    expect(detail, isNotNull);
    expect(detail!.creator.name, 'Seed Author 001');
    expect(detail.creator.seriesCount, 1);
    expect(detail.series.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(detail.series.nextToken, isEmpty);

    final request = server.requestsTo('GetPublishedCreatorDetail').single;
    expect(request.body['publicId'], 'SeedAUTHAAA1');
    expect(request.body['limit'], 20);
    expect(request.body.containsKey('token'), isFalse);
  });

  test('getCreatorDetail asks for the page its token names', () async {
    server.seriesPageSize = 1;
    server.series = [
      ...ConnectFixtureServer.populatedSeries(),
      {
        'publicId': 'series-second',
        'title': 'Second Series',
        'creators': ConnectFixtureServer.seedCreators(),
      },
    ];

    final first = await catalog.getCreatorDetail('SeedAUTHAAA1');
    final second = await catalog.getCreatorDetail(
      'SeedAUTHAAA1',
      token: first!.series.nextToken,
    );

    expect(first.series.nextToken, isNotEmpty);
    expect(second!.series.series.single.id, 'series-second');
    expect(
      server.requestsTo('GetPublishedCreatorDetail').last.body['token'],
      first.series.nextToken,
    );
  });

  test(
    'getCreatorDetail returns null for an author the API does not know',
    () async {
      expect(await catalog.getCreatorDetail('ZZZZZZZZZZZZ'), isNull);
    },
  );

  test('getLabelDetail carries the label and its series', () async {
    final detail = await catalog.getLabelDetail('SeedLABLAAA1');

    expect(detail, isNotNull);
    expect(detail!.label.name, 'Seed Label 01');
    expect(detail.label.seriesCount, 1);
    expect(detail.series.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(
      server.requestsTo('GetPublishedLabelDetail').single.body['publicId'],
      'SeedLABLAAA1',
    );
  });

  test(
    'getLabelDetail returns null for a label the API does not know',
    () async {
      expect(await catalog.getLabelDetail('ZZZZZZZZZZZZ'), isNull);
    },
  );

  test('listGenres reads every page of genres, counted', () async {
    server
      ..genres = ConnectFixtureServer.populatedGenres()
      ..seriesPageSize = 1;

    final genres = await catalog.listGenres();

    expect(
      [for (final genre in genres) genre.id],
      ['SeedGENRAAA1', 'SeedGENRAAA2'],
    );
    expect(genres.first.name, 'Fantasy');
    expect(genres.first.seriesCount, 1);
    // A genre nothing published carries is listed at zero.
    expect(genres.last.seriesCount, 0);
    final requests = server.requestsTo('ListPublishedGenres');
    expect(requests, hasLength(2));
    expect(requests.first.body['limit'], 100);
    expect(requests.first.body['surface'], 'CLIENT_SURFACE_APP');
    expect(requests.last.body['token'], '1');
  });

  test(
    'listGenres carries each genre\'s covers in the order they came',
    () async {
      server.genres = [
        {
          ...ConnectFixtureServer.seedGenres().first,
          'featuredSeries': [
            {
              'publicId': ConnectFixtureServer.seedSeriesId,
              'title': ConnectFixtureServer.seedSeriesTitle,
              'eyeCatchImageVariants':
                  ConnectFixtureServer.seedEyeCatchVariants(),
            },
            {'publicId': 'series-kitchen', 'title': 'The Little Kitchen'},
          ],
        },
        {'publicId': 'SeedGENRAAA2', 'name': 'Romance', 'slug': 'romance'},
      ];

      final genres = await catalog.listGenres();

      final featured = genres.first.featuredSeries;
      expect(
        [for (final series in featured) series.id],
        [ConnectFixtureServer.seedSeriesId, 'series-kitchen'],
      );
      expect(
        featured.first.eyeCatchVariants.first.url.toString(),
        '${server.baseUrl}/images/series/'
        '${ConnectFixtureServer.seedSeriesImageId}/portrait/400',
      );
      // A series with no artwork is still a cell of the tile, drawn flat.
      expect(featured.last.eyeCatchVariants, isEmpty);
      expect(genres.first.imageRequestHeaders, {
        'x-forwarded-host': 'localhost',
      });
      // protojson omits an empty repeated field, which is a genre with none.
      expect(genres.last.featuredSeries, isEmpty);
    },
  );

  test(
    'listGenres carries the eye-catch uploaded for a genre, and none for one '
    'without',
    () async {
      server.genres = [
        {
          ...ConnectFixtureServer.seedGenres().first,
          'eyeCatchImageVariants': [
            {
              'label': 'portrait_600w',
              'variantType': 'portrait',
              'url': '/images/genres/SeedGENRAAA1/portrait/600',
              'contentType': 'image/webp',
              'width': 600,
              'height': 800,
            },
          ],
        },
        {'publicId': 'SeedGENRAAA2', 'name': 'Romance', 'slug': 'romance'},
      ];

      final genres = await catalog.listGenres();

      final eyeCatch = genres.first.eyeCatchVariants.single;
      expect(eyeCatch.variantType, 'portrait');
      expect(
        eyeCatch.url.toString(),
        '${server.baseUrl}/images/genres/SeedGENRAAA1/portrait/600',
      );
      expect(eyeCatch.width, 600);
      // protojson omits an empty repeated field, which is a genre with none.
      expect(genres.last.eyeCatchVariants, isEmpty);
    },
  );

  test('listGenres drops a cover that names no series', () async {
    server.genres = [
      {
        ...ConnectFixtureServer.seedGenres().first,
        'featuredSeries': [
          {'publicId': '  ', 'title': 'Nameless'},
          {'publicId': 'series-kitchen', 'title': 'The Little Kitchen'},
        ],
      },
    ];

    final genres = await catalog.listGenres();

    expect(
      [for (final series in genres.single.featuredSeries) series.id],
      ['series-kitchen'],
    );
  });

  test('listGenres reads a tenant with no genre as empty', () async {
    expect(await catalog.listGenres(), isEmpty);
  });

  test('getTag walks the tags until the slug turns up', () async {
    server
      ..seriesPageSize = 1
      ..series = [
        {
          ...ConnectFixtureServer.populatedSeries().first,
          'tags': [
            {'name': 'Found family', 'slug': 'found-family'},
            {'name': 'Time travel', 'slug': 'time-travel'},
          ],
        },
      ];

    final tag = await catalog.getTag('time-travel');

    expect(tag!.name, 'Time travel');
    expect(tag.seriesCount, 1);
    expect(server.requestsTo('ListPublishedTags'), hasLength(2));
  });

  test('getTag returns null for a tag nothing published carries', () async {
    expect(await catalog.getTag('missing'), isNull);
  });

  test('listGenreSeries asks for one genre under the filter', () async {
    server.genres = ConnectFixtureServer.populatedGenres();

    final page = await catalog.listGenreSeries(
      'SeedGENRAAA1',
      filter: const SeriesListFilter(
        order: SeriesListOrder.updated,
        status: SeriesStatus.ongoing,
        freeOnly: true,
      ),
    );

    expect(page!.series.single.id, ConnectFixtureServer.seedSeriesId);
    final body = server.requestsTo('ListPublishedSeries').single.body;
    expect(body['genrePublicId'], 'SeedGENRAAA1');
    expect(body['order'], 'SERIES_ORDER_LATEST_EPISODE_AT_DESC');
    expect(body['status'], 'SERIES_STATUS_ONGOING');
    expect(body['hasFreeEpisodes'], isTrue);
    expect(body['surface'], 'CLIENT_SURFACE_APP');
    expect(body.containsKey('tagSlug'), isFalse);
  });

  test('listGenreSeries leaves an unnarrowed list to the newest', () async {
    server.genres = ConnectFixtureServer.populatedGenres();

    await catalog.listGenreSeries('SeedGENRAAA1');

    final body = server.requestsTo('ListPublishedSeries').single.body;
    expect(body['order'], 'SERIES_ORDER_PUBLISHED_AT_DESC');
    // protojson omits a default, and an omitted filter keeps everything.
    expect(body.containsKey('status'), isFalse);
    expect(body.containsKey('hasFreeEpisodes'), isFalse);
    expect(body.containsKey('token'), isFalse);
  });

  test(
    'listGenreSeries returns null for a genre the API does not know',
    () async {
      expect(await catalog.listGenreSeries('ZZZZZZZZZZZZ'), isNull);
    },
  );

  test('listTagSeries asks for the page its token names', () async {
    server
      ..seriesPageSize = 1
      ..series = [
        for (final item in ConnectFixtureServer.populatedSeries())
          {...item, 'tags': ConnectFixtureServer.seedTags()},
      ];
    final first = await catalog.listTagSeries('time-travel');

    final second = await catalog.listTagSeries(
      'time-travel',
      token: first!.nextToken,
    );

    expect(second!.series.single.id, 'series-kitchen');
    final body = server.requestsTo('ListPublishedSeries').last.body;
    expect(body['tagSlug'], 'time-travel');
    expect(body['token'], first.nextToken);
  });

  test('listTagSeries returns null for a tag the API does not know', () async {
    expect(await catalog.listTagSeries('missing'), isNull);
  });

  test('listSeries carries the public id of the label', () async {
    final page = await catalog.listSeries();

    expect(page.series.first.labelId, 'SeedLABLAAA1');
    expect(page.series.first.labelName, 'Seed Label 01');
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
      '${server.baseUrl}/images/episodes/${ConnectFixtureServer.seedEpisodeId}-page-1'
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

  test('getEpisode carries the episodes either side of this one', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Middle', 'orderIndex': 2},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_FREE',
      'previousEpisode': {
        'publicId': 'EP01',
        'title': 'First',
        'orderIndex': 1,
        'isFree': true,
      },
      'nextEpisode': {
        'publicId': 'EP03',
        'title': 'Third',
        'orderIndex': 3,
        'price': 500,
      },
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.previousEpisode!.id, 'EP01');
    expect(detail.previousEpisode!.isFree, isTrue);
    expect(detail.nextEpisode!.title, 'Third');
    expect(detail.nextEpisode!.price, 500);
    // protojson omits a false, so a paid neighbour arrives without the field.
    expect(detail.nextEpisode!.isFree, isFalse);
  });

  test(
    'getEpisode reads where the episode and its neighbours are sold',
    () async {
      server.episodeResponse = {
        'episode': {
          'publicId': 'EP',
          'title': 'Middle',
          'orderIndex': 2,
          'price': 300,
          'purchaseAvailability': 'SURFACE_AVAILABILITY_WEB',
        },
        'series': {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
        },
        'access': 'EPISODE_ACCESS_LOCKED',
        'previousEpisode': {
          'publicId': 'EP01',
          'title': 'First',
          'orderIndex': 1,
          'price': 300,
          'purchaseAvailability': 'SURFACE_AVAILABILITY_APP',
        },
        'nextEpisode': {
          'publicId': 'EP03',
          'title': 'Third',
          'orderIndex': 3,
          'price': 300,
        },
      };

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      );

      expect(detail!.episode.purchaseSurface, EpisodePurchaseSurface.web);
      expect(
        detail.previousEpisode!.purchaseSurface,
        EpisodePurchaseSurface.app,
      );
      // protojson omits unspecified, which is how every episode was sold before
      // the setting existed.
      expect(detail.nextEpisode!.purchaseSurface, EpisodePurchaseSurface.all);
    },
  );

  test('getEpisode reports no neighbour at the ends of the series', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    // protojson omits an unset message, which is what the server sends where
    // there is no episode on that side.
    expect(detail!.previousEpisode, isNull);
    expect(detail.nextEpisode, isNull);
  });

  test(
    'getEpisode hands the viewer the episode\'s resolved reading direction and spread start',
    () async {
      server.episodeResponse = {
        'episode': {
          'publicId': 'EP',
          'title': 'Left to right',
          'readingDirection': 'READING_DIRECTION_LEFT_TO_RIGHT',
          'spreadStartIndex': 0,
        },
        'series': {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
        },
        'access': 'EPISODE_ACCESS_FREE',
      };

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      );

      expect(detail!.readingDirection, ReadingDirection.ltr);
      expect(detail.spreadStartIndex, 0);
    },
  );

  test(
    'getEpisode reads an omitted direction as right to left and an omitted spread start as pairing from the first page',
    () async {
      server.episodeResponse = {
        'episode': {'publicId': 'EP', 'title': 'Omitted layout'},
        'series': {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
        },
        'access': 'EPISODE_ACCESS_FREE',
      };

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      );

      // protojson omits unspecified and zero. Unspecified is the series
      // default of right to left; zero is pairing from the first page.
      expect(detail!.readingDirection, ReadingDirection.rtl);
      expect(detail.spreadStartIndex, 0);
    },
  );

  test(
    'getEpisode reads a never-edited series as right to left from the cover',
    () async {
      server.episodeResponse = {
        'episode': {
          'publicId': 'EP',
          'title': 'Never edited',
          'readingDirection': 'READING_DIRECTION_RIGHT_TO_LEFT',
          'spreadStartIndex': 1,
        },
        'series': {
          'publicId': ConnectFixtureServer.seedSeriesId,
          'title': ConnectFixtureServer.seedSeriesTitle,
        },
        'access': 'EPISODE_ACCESS_FREE',
      };

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
      );

      expect(detail!.readingDirection, ReadingDirection.rtl);
      expect(detail.spreadStartIndex, 1);
    },
  );

  test('getEpisode carries the credits of the episode itself', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(
      detail!.creators.map((creator) => (creator.roleName, creator.name)),
      [
        ('Story', 'Seed Author 001'),
        ('Art', 'Seed Author 002'),
        ('Art', 'Seed Author 003'),
      ],
    );
  });

  test(
    'getEpisode reads an episode credited to nobody as carrying none',
    () async {
      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.paidEpisodeId,
      );

      expect(detail!.creators, isEmpty);
    },
  );

  test('getEpisode reports a locked paid body with no pages', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.locked);
    expect(detail.images, isEmpty);
  });

  test('getEpisode reports a body withheld over the reader\'s age', () async {
    server.episodeResponse = {
      'episode': {'publicId': 'EP', 'title': 'Rated'},
      'series': {
        'publicId': ConnectFixtureServer.seedSeriesId,
        'title': ConnectFixtureServer.seedSeriesTitle,
      },
      'access': 'EPISODE_ACCESS_AGE_RESTRICTED',
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
    );

    expect(detail!.access, EpisodeAccess.ageRestricted);
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
    final config = AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost');
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

  test('getEpisode asks with the session it was called under, not the one that '
      'replaced it', () async {
    var accessToken = ConnectFixtureServer.memberAccessToken;
    final authenticated = HttpCatalogRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
      client: ConnectClient(
        baseUrl: server.baseUrl,
        accessToken: () => accessToken,
      ),
    );

    final read = authenticated.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
    );
    // The reader signs out while the tenant lookup is still in flight.
    accessToken = '';
    final detail = await read;

    expect(
      server.requestsTo('GetEpisodeDetail').single.headers['authorization'],
      'Bearer ${ConnectFixtureServer.memberAccessToken}',
    );
    expect(detail!.access, EpisodeAccess.entitled);
    expect(
      detail.imageRequestHeaders['authorization'],
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

  group('the surface the app names', () {
    const webOnly = ConnectFixtureServer.seedSeriesId;
    const appOnly = 'series-kitchen';

    setUp(() {
      server.seriesAvailability = {
        webOnly: 'SURFACE_AVAILABILITY_WEB',
        appOnly: 'SURFACE_AVAILABILITY_APP',
      };
      server.rankedSeries = [
        for (final (index, series) in server.series.indexed)
          {'rank': index + 1, 'series': series},
      ];
    });

    test('every catalog read names the app', () async {
      await catalog.listSeries();
      await catalog.listNewestSeries(limit: 3);
      await catalog.listRankedSeries(limit: 3, period: RankingPeriod.daily);
      await catalog.searchSeries(query: 'Seed');
      await catalog.searchCreators(query: 'Seed');
      await catalog.searchLabels(query: 'Seed');
      await catalog.getSeries(webOnly);
      await catalog.getCreator('SeedAUTHAAA1');
      await catalog.getCreatorDetail('SeedAUTHAAA1');
      await catalog.getLabelDetail('SeedLABLAAA1');
      await catalog.getEpisode(webOnly, ConnectFixtureServer.seedEpisodeId);

      final reads = server.requests.where(
        (request) => request.path.contains('/publira.v1.CatalogService/'),
      );
      expect(
        {for (final read in reads) read.path.split('/').last},
        {
          'ListPublishedSeries',
          'ListRankedSeries',
          'SearchPublishedSeries',
          'SearchPublishedCreators',
          'SearchPublishedLabels',
          'GetSeriesDetail',
          'GetPublishedCreatorDetail',
          'GetPublishedLabelDetail',
          'GetEpisodeDetail',
        },
      );
      for (final read in reads) {
        expect(read.body['surface'], 'CLIENT_SURFACE_APP', reason: read.path);
      }
    });

    test(
      'a series the storefront alone shows is left out of every list',
      () async {
        final ids = [
          for (final series in (await catalog.listSeries()).series) series.id,
        ];
        final ranked = await catalog.listRankedSeries(
          limit: 3,
          period: RankingPeriod.weekly,
        );
        final searched = await catalog.searchSeries(query: 'Seed');

        expect(ids, [appOnly]);
        expect([for (final item in ranked) item.series.id], [appOnly]);
        expect(searched.series, isEmpty);
      },
    );

    test(
      'a series the storefront alone shows reads as missing, episodes too',
      () async {
        expect(await catalog.getSeries(webOnly), isNull);
        expect(
          await catalog.getEpisode(webOnly, ConnectFixtureServer.seedEpisodeId),
          isNull,
        );
      },
    );

    test(
      'a label whose series the storefront alone shows still opens, empty',
      () async {
        final detail = await catalog.getLabelDetail('SeedLABLAAA1');

        expect(detail, isNotNull);
        expect(detail!.label.seriesCount, 0);
        expect(detail.series.series, isEmpty);
      },
    );

    test('a series shown on both surfaces reads as it always has', () async {
      server.seriesAvailability = {webOnly: 'SURFACE_AVAILABILITY_ALL'};

      expect(await catalog.getSeries(webOnly), isNotNull);
      expect(
        await catalog.getEpisode(webOnly, ConnectFixtureServer.seedEpisodeId),
        isNotNull,
      );
      expect((await catalog.listSeries()).series, hasLength(2));
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

    expect((await catalog.listSeries()).series, isNotEmpty);
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
      baseUrl: 'https://example.test',
      tenantHost: 'localhost',
    );
    final unresponsive = HttpCatalogRepository(
      config: config,
      client: ConnectClient(
        baseUrl: config.baseUrl,
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
    final items = (await catalog.listSeries()).series;
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

  group('the reading history of one member', () {
    late HttpCatalogRepository signedIn;

    setUp(() {
      server
        ..readingPositions = {ConnectFixtureServer.seedEpisodeId: 11}
        ..recentSeries = ConnectFixtureServer.populatedRecentSeries()
        ..episodeReadHistory = ConnectFixtureServer.populatedEpisodeReads();
      signedIn = HttpCatalogRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: ConnectClient(
          baseUrl: server.baseUrl,
          accessToken: () => ConnectFixtureServer.memberAccessToken,
        ),
      );
    });

    test('every call of the reader\'s own names the app', () async {
      const episodeId = ConnectFixtureServer.seedEpisodeId;
      await signedIn.getReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        episodeId,
      );
      await signedIn.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        episodeId,
        4,
      );
      await signedIn.markEpisodeAsRead(episodeId);
      await signedIn.listRecentSeries(limit: 6);
      await signedIn.listEpisodeReads(limit: 20);
      await signedIn.getEpisodeReaction(episodeId);
      await signedIn.reactToEpisode(episodeId);

      final calls = server.requests.where(
        (request) =>
            request.path.contains('/publira.v1.EpisodeReadService/') ||
            request.path.contains('/publira.v1.RatingService/'),
      );
      expect(
        {for (final call in calls) call.path.split('/').last},
        {
          'GetMyReadingPosition',
          'SaveReadingPosition',
          'MarkEpisodeAsRead',
          'ListMyRecentSeries',
          'ListMyEpisodeReads',
          'GetMyEpisodeRating',
          'RateEpisode',
        },
      );
      for (final call in calls) {
        expect(call.body['surface'], 'CLIENT_SURFACE_APP', reason: call.path);
      }
    });

    test('getReadingPosition answers the page the member stopped on', () async {
      expect(
        await signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
        ),
        11,
      );
    });

    test('an episode the member never opened has no position', () async {
      expect(
        await signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.paidEpisodeId,
        ),
        isNull,
      );
    });

    test('saveReadingPosition records the page against the episode', () async {
      await signedIn.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        4,
      );

      expect(server.readingPositions[ConnectFixtureServer.seedEpisodeId], 4);
      final recorded = server.requestsTo('SaveReadingPosition').single;
      expect(
        recorded.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
      expect(
        (recorded.body['tenant']! as Map)['tenantId'],
        ConnectFixtureServer.defaultTenantId,
      );
    });

    test('markEpisodeAsRead records the finish against the episode', () async {
      await signedIn.markEpisodeAsRead(ConnectFixtureServer.seedEpisodeId);

      expect(server.episodeReads.keys, [ConnectFixtureServer.seedEpisodeId]);
      final recorded = server.requestsTo('MarkEpisodeAsRead').single;
      expect(
        recorded.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
      expect(
        (recorded.body['tenant']! as Map)['tenantId'],
        ConnectFixtureServer.defaultTenantId,
      );
    });

    for (final (code, refused) in [
      ('not_found', true),
      ('invalid_argument', true),
      ('internal', false),
    ]) {
      test('a finish answered $code is ${refused ? '' : 'not '}a refusal', () {
        server.markReadErrorCode = code;

        expect(
          () => signedIn.markEpisodeAsRead(ConnectFixtureServer.seedEpisodeId),
          throwsA(
            isA<CatalogFailure>().having(
              (failure) => failure.refused,
              'refused',
              refused,
            ),
          ),
        );
      });
    }

    test('listRecentSeries maps the series and the episode to open', () async {
      final items = (await signedIn.listRecentSeries(limit: 6)).series;

      expect(items, hasLength(1));
      expect(items.single.series.id, ConnectFixtureServer.seedSeriesId);
      expect(items.single.series.eyeCatchVariants, isNotEmpty);
      expect(items.single.episode.id, ConnectFixtureServer.seedEpisodeId);
      expect(server.requestsTo('ListMyRecentSeries').single.body['limit'], 6);
    });

    test('listRecentSeries asks for the page the token names', () async {
      server.recentSeries = [
        for (final id in ['series-a', 'series-b', 'series-c'])
          {
            ...server.recentSeries.single,
            'series': {
              ...server.recentSeries.single['series']! as Map<String, Object?>,
              'publicId': id,
            },
          },
      ];

      final first = await signedIn.listRecentSeries(limit: 2);
      final second = await signedIn.listRecentSeries(
        limit: 2,
        token: first.nextToken,
      );

      expect(first.series.map((item) => item.series.id), [
        'series-a',
        'series-b',
      ]);
      expect(first.nextToken, isNotEmpty);
      expect(second.series.single.series.id, 'series-c');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsTo('ListMyRecentSeries');
      expect(requests.first.body.containsKey('token'), isFalse);
      expect(requests.last.body['token'], first.nextToken);
    });

    test('listEpisodeReads maps the episode, its series, and when', () async {
      final reads = (await signedIn.listEpisodeReads(limit: 20)).reads;

      expect(reads, hasLength(1));
      expect(reads.single.series.id, ConnectFixtureServer.seedSeriesId);
      expect(reads.single.series.title, ConnectFixtureServer.seedSeriesTitle);
      expect(reads.single.episode.id, ConnectFixtureServer.seedEpisodeId);
      expect(reads.single.episode.orderIndex, 1);
      expect(reads.single.readAt, DateTime.utc(2026, 9, 1).toLocal());
      final request = server.requestsTo('ListMyEpisodeReads').single;
      expect(request.body['limit'], 20);
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test('listEpisodeReads asks for the page the token names', () async {
      final read = server.episodeReadHistory.single;
      server.episodeReadHistory = [
        for (final id in ['episode-a', 'episode-b', 'episode-c'])
          {
            ...read,
            'episode': {
              ...read['episode']! as Map<String, Object?>,
              'publicId': id,
            },
          },
      ];

      final first = await signedIn.listEpisodeReads(limit: 2);
      final second = await signedIn.listEpisodeReads(
        limit: 2,
        token: first.nextToken,
      );

      expect(first.reads.map((read) => read.episode.id), [
        'episode-a',
        'episode-b',
      ]);
      expect(second.reads.single.episode.id, 'episode-c');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsTo('ListMyEpisodeReads');
      expect(requests.first.body.containsKey('token'), isFalse);
      expect(requests.last.body['token'], first.nextToken);
    });

    test('a member who finished nothing has an empty history', () async {
      server.episodeReadHistory = const [];

      final page = await signedIn.listEpisodeReads(limit: 20);

      expect(page.reads, isEmpty);
      expect(page.nextToken, isEmpty);
    });

    test('a guest asks the API for none of it', () async {
      expect(
        await catalog.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
        ),
        isNull,
      );
      await catalog.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        4,
      );
      await catalog.markEpisodeAsRead(ConnectFixtureServer.seedEpisodeId);
      expect((await catalog.listRecentSeries(limit: 6)).series, isEmpty);
      expect((await catalog.listEpisodeReads(limit: 20)).reads, isEmpty);

      // Nothing was asked, so nothing was refused: the API answers a request
      // without a session `unauthenticated`, and there is no answer in that
      // worth a round trip.
      expect(server.requestsTo('GetMyReadingPosition'), isEmpty);
      expect(server.requestsTo('SaveReadingPosition'), isEmpty);
      expect(server.requestsTo('MarkEpisodeAsRead'), isEmpty);
      expect(server.requestsTo('ListMyRecentSeries'), isEmpty);
      expect(server.requestsTo('ListMyEpisodeReads'), isEmpty);
      expect(server.readingPositions[ConnectFixtureServer.seedEpisodeId], 11);
    });

    test('a rejected session is reported rather than resumed from', () async {
      server.activeAccessToken = 'another-token';

      expect(
        () => signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
        ),
        throwsA(
          isA<CatalogFailure>().having(
            (error) => error.kind,
            'kind',
            CatalogFailureKind.sessionExpired,
          ),
        ),
      );
      expect(
        () => signedIn.listEpisodeReads(limit: 20),
        throwsA(
          isA<CatalogFailure>().having(
            (error) => error.kind,
            'kind',
            CatalogFailureKind.sessionExpired,
          ),
        ),
      );
    });
  });

  group('the follow updates of one member', () {
    late HttpCatalogRepository signedIn;

    /// A newly published episode of [seriesId].
    Map<String, Object?> arrival(String seriesId, String episodeId) {
      return {
        'series': {'publicId': seriesId, 'title': 'Series $seriesId'},
        'episode': {
          'publicId': episodeId,
          'title': 'Episode $episodeId',
          'orderIndex': 3,
          'price': 0,
          'publishedAt': '2026-09-01T00:00:00Z',
        },
      };
    }

    setUp(() {
      server.followUpdates = [
        arrival('series-a', 'episode-a'),
        arrival('series-b', 'episode-b'),
      ];
      signedIn = HttpCatalogRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: ConnectClient(
          baseUrl: server.baseUrl,
          accessToken: () => ConnectFixtureServer.memberAccessToken,
        ),
      );
    });

    test('maps the episode, its series, and when it was published', () async {
      final updates = (await signedIn.listFollowUpdates(limit: 20)).updates;

      expect(updates.first.series.id, 'series-a');
      expect(updates.first.series.title, 'Series series-a');
      expect(updates.first.episode.id, 'episode-a');
      expect(updates.first.episode.orderIndex, 3);
      expect(updates.first.publishedAt, DateTime.utc(2026, 9, 1).toLocal());
      final request = server.requestsTo('ListMyFollowUpdates').single;
      expect(request.body['limit'], 20);
      expect(request.body['surface'], 'CLIENT_SURFACE_APP');
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test('asks for the page the token names', () async {
      final first = await signedIn.listFollowUpdates(limit: 1);
      final second = await signedIn.listFollowUpdates(
        limit: 1,
        token: first.nextToken,
      );

      expect(first.updates.single.episode.id, 'episode-a');
      expect(second.updates.single.episode.id, 'episode-b');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsTo('ListMyFollowUpdates');
      expect(requests.first.body.containsKey('token'), isFalse);
      expect(requests.last.body['token'], first.nextToken);
    });

    test('a member with nothing new has an empty list', () async {
      server.followUpdates = const [];

      final page = await signedIn.listFollowUpdates(limit: 20);

      expect(page.updates, isEmpty);
      expect(page.nextToken, isEmpty);
    });

    test('an episode without a readable publish time still lists', () async {
      final update = server.followUpdates.first;
      server.followUpdates = [
        {
          ...update,
          'episode': {
            ...update['episode']! as Map<String, Object?>,
            'publishedAt': 'not a time',
          },
        },
      ];

      final updates = (await signedIn.listFollowUpdates(limit: 20)).updates;

      expect(updates.single.publishedAt, isNull);
    });

    test('a guest asks the API for none of it', () async {
      expect((await catalog.listFollowUpdates(limit: 20)).updates, isEmpty);
      expect(server.requestsTo('ListMyFollowUpdates'), isEmpty);
    });

    test('a rejected session is reported as one', () async {
      server.activeAccessToken = 'another-token';

      expect(
        () => signedIn.listFollowUpdates(limit: 20),
        throwsA(
          isA<CatalogFailure>().having(
            (error) => error.kind,
            'kind',
            CatalogFailureKind.sessionExpired,
          ),
        ),
      );
    });
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
