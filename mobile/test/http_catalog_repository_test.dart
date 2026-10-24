import 'dart:io';

import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/gen/publira/v1/domain.pb.dart' as pb;
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/http_catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';

import 'support/connect_fixture_server.dart';
import 'support/proto_response.dart';

/// [message] answering its enum field [tagNumber] with a number no enum here
/// names, the way an API that has grown a value answers this build. No
/// generated enum holds such a number, so it goes out as the unknown field the
/// decoder reads it into.
T withUnnamedEnum<T extends GeneratedMessage>(T message, int tagNumber) =>
    message..unknownFields.mergeVarintField(tagNumber, Int64(999));

/// `Series.age_rating`.
const _seriesAgeRatingField = 15;

/// `GetEpisodeDetailResponse.access`.
const _episodeAccessField = 4;

/// `GetEpisodeDetailResponse.entitlement_source`.
const _episodeEntitlementSourceField = 8;

/// [genre], as a `Series` carries it, as `ListPublishedGenres` answers it,
/// with the covers a test gives it.
pb.PublishedGenre publishedGenreOf(
  pb.Genre genre, {
  Iterable<pb.PublishedGenreFeaturedSeries>? featuredSeries,
  Iterable<pb.SeriesEyeCatchVariant>? eyeCatchImageVariants,
}) => pb.PublishedGenre(
  publicId: genre.publicId,
  name: genre.name,
  slug: genre.slug,
  featuredSeries: featuredSeries,
  eyeCatchImageVariants: eyeCatchImageVariants,
);

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
    final items = (await catalog.listSeries(locale: 'en')).series;
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
        ConnectFixtureServer.populatedSeries().first..ratingAverage = 6,
      ];

      expect(
        () => catalog.listSeries(locale: 'en'),
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
    await catalog.listSeries(locale: 'en');

    final request = server.requestsOf(pb.ListPublishedSeriesRequest.new).single;
    expect(request.order, pb.SeriesOrder.SERIES_ORDER_TITLE_ASC);
    expect(request.limit, 20);
    // The wire format omits a default, and an omitted token is the first page.
    expect(request.hasToken(), isFalse);
  });

  test('listSeries carries the token of the page under the first', () async {
    server.seriesPageSize = 1;

    final first = await catalog.listSeries(locale: 'en');

    expect(first.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(first.nextToken, isNotEmpty);
  });

  test('listSeries asks for the page its token names', () async {
    server.seriesPageSize = 1;
    final first = await catalog.listSeries(locale: 'en');

    final second = await catalog.listSeries(
      token: first.nextToken,
      locale: 'en',
    );

    expect(second.series.single.id, 'series-kitchen');
    final request = server.requestsOf(pb.ListPublishedSeriesRequest.new).last;
    expect(request.token, first.nextToken);
    // The order travels with every page: a token is only good for the list it
    // was cut from.
    expect(request.order, pb.SeriesOrder.SERIES_ORDER_TITLE_ASC);
  });

  test('listSeries reads the last page as the end of the catalog', () async {
    server.seriesPageSize = 1;
    final first = await catalog.listSeries(locale: 'en');

    final last = await catalog.listSeries(token: first.nextToken, locale: 'en');

    expect(last.nextToken, isEmpty);
  });

  test('listSeries reads a catalog of one page as ending there', () async {
    expect((await catalog.listSeries(locale: 'en')).nextToken, isEmpty);
  });

  test('searchSeries maps the matching series onto SeriesItem', () async {
    final page = await catalog.searchSeries(query: 'Kitchen', locale: 'en');

    expect(page.series.single.id, 'series-kitchen');
    expect(page.series.single.title, 'The Little Kitchen');
  });

  test('searchSeries asks for the keyword the reader typed', () async {
    await catalog.searchSeries(query: 'Kitchen', locale: 'en');

    final request = server
        .requestsOf(pb.SearchPublishedSeriesRequest.new)
        .single;
    expect(request.query, 'Kitchen');
    expect(request.limit, 20);
    // The wire format omits a default, and an omitted token is the first page.
    expect(request.hasToken(), isFalse);
  });

  test('searchSeries asks for the page its token names', () async {
    server.seriesPageSize = 1;
    server.series = [
      ...ConnectFixtureServer.populatedSeries(),
      pb.Series(publicId: 'series-second-kitchen', title: 'Kitchen Nights'),
    ];

    final first = await catalog.searchSeries(query: 'Kitchen', locale: 'en');

    // The results are in title order, so `Kitchen Nights` stands above
    // `The Little Kitchen` however the tenant published them.
    expect(first.series.single.id, 'series-second-kitchen');
    expect(first.nextToken, isNotEmpty);

    final second = await catalog.searchSeries(
      query: 'Kitchen',
      token: first.nextToken,
      locale: 'en',
    );

    expect(second.series.single.id, 'series-kitchen');
    expect(second.nextToken, isEmpty);
    final request = server.requestsOf(pb.SearchPublishedSeriesRequest.new).last;
    expect(request.token, first.nextToken);
    // The token belongs to the keyword it was built for, so it travels with
    // the same query rather than on its own.
    expect(request.query, 'Kitchen');
  });

  test('searchSeries reads a keyword nothing matches as empty', () async {
    final page = await catalog.searchSeries(
      query: 'nothing here',
      locale: 'en',
    );

    expect(page.series, isEmpty);
    expect(page.nextToken, isEmpty);
  });

  test('a search the API could not answer is a network failure', () async {
    server.searchStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.searchSeries(query: 'Kitchen', locale: 'en'),
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
    final items = await catalog.listNewestSeries(limit: 10, locale: 'en');

    expect(items.first.id, ConnectFixtureServer.seedSeriesId);
    final request = server.requestsOf(pb.ListPublishedSeriesRequest.new).single;
    expect(request.order, pb.SeriesOrder.SERIES_ORDER_PUBLISHED_AT_DESC);
    expect(request.limit, 10);
  });

  test('listRankedSeries maps a snapshot onto its positions', () async {
    final ranked = await catalog.listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      locale: 'en',
    );

    final positions = ranked.rankedSeries;
    expect(positions, hasLength(2));
    expect(positions.first.rank, 1);
    expect(positions.first.series.id, ConnectFixtureServer.seedSeriesId);
    expect(positions.first.series.eyeCatchVariants, isNotEmpty);
    // A snapshot keeps the positions it recorded, so a series unpublished
    // since leaves the gap it was in.
    expect(positions.last.rank, 3);
    expect(ranked.nextToken, isEmpty);

    final request = server.requestsOf(pb.ListRankedSeriesRequest.new).single;
    expect(request.period, pb.RankingPeriod.RANKING_PERIOD_WEEKLY);
    expect(request.limit, 10);
    expect(request.ageRating, pb.SeriesAgeRating.SERIES_AGE_RATING_ALL);
    // The first page names no token, as every list RPC's first page does.
    expect(request.hasToken(), isFalse);
  });

  test('listRankedSeries hands the next token back unchanged', () async {
    server.rankedSeriesPageSize = 1;

    final first = await catalog.listRankedSeries(
      limit: 20,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      locale: 'en',
    );
    final second = await catalog.listRankedSeries(
      limit: 20,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      token: first.nextToken,
      locale: 'en',
    );

    expect([for (final item in first.rankedSeries) item.rank], [1]);
    expect(first.nextToken, isNotEmpty);
    expect([for (final item in second.rankedSeries) item.rank], [3]);
    expect(second.nextToken, isEmpty);
    expect(
      server.requestsOf(pb.ListRankedSeriesRequest.new).last.token,
      first.nextToken,
    );
  });

  test('listRankedSeries names the day the daily chart asks for', () async {
    await catalog.listRankedSeries(
      limit: 3,
      period: RankingPeriod.daily,
      ageRating: SeriesAgeRating.all,
      locale: 'en',
    );

    expect(
      server.requestsOf(pb.ListRankedSeriesRequest.new).single.period,
      pb.RankingPeriod.RANKING_PERIOD_DAILY,
    );
  });

  test('listRankedSeries names the genre a chart is narrowed to', () async {
    server
      ..genres = ConnectFixtureServer.populatedGenres()
      ..genreRankedSeries = {
        'SeedGENRAAA1': [ConnectFixtureServer.populatedRankedSeries().last],
      };

    final ranked = await catalog.listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      genreId: 'SeedGENRAAA1',
      locale: 'en',
    );

    expect(
      [for (final item in ranked.rankedSeries) item.series.id],
      ['series-kitchen'],
    );
    expect(
      server.requestsOf(pb.ListRankedSeriesRequest.new).single.genrePublicId,
      'SeedGENRAAA1',
    );
  });

  test('listRankedSeries names no genre for the tenant-wide chart', () async {
    await catalog.listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      locale: 'en',
    );

    // The wire format omits an empty string, so the tenant-wide chart sends
    // none.
    expect(
      server
          .requestsOf(pb.ListRankedSeriesRequest.new)
          .single
          .hasGenrePublicId(),
      isFalse,
    );
  });

  test('a genre the batch has not ranked reads as an empty chart', () async {
    server.genres = ConnectFixtureServer.populatedGenres();

    final ranked = await catalog.listRankedSeries(
      limit: 10,
      period: RankingPeriod.weekly,
      ageRating: SeriesAgeRating.all,
      genreId: 'SeedGENRAAA2',
      locale: 'en',
    );

    expect(ranked.rankedSeries, isEmpty);
  });

  test('a chart of a genre the tenant does not curate is refused', () async {
    server.genres = ConnectFixtureServer.populatedGenres();

    expect(
      () => catalog.listRankedSeries(
        limit: 10,
        period: RankingPeriod.weekly,
        ageRating: SeriesAgeRating.all,
        genreId: 'missing',
        locale: 'en',
      ),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.refused,
          'refused',
          isTrue,
        ),
      ),
    );
  });

  test('a tenant with no snapshot reads as an empty chart', () async {
    server.rankedSeries = const [];

    expect(
      await catalog.listRankedSeries(
        limit: 10,
        period: RankingPeriod.weekly,
        ageRating: SeriesAgeRating.all,
        locale: 'en',
      ),
      isA<RankedSeriesPage>()
          .having((page) => page.rankedSeries, 'rankedSeries', isEmpty)
          .having((page) => page.nextToken, 'nextToken', isEmpty),
    );
  });

  test('a ranking the API could not answer is a failure', () async {
    server.rankedStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.listRankedSeries(
        limit: 10,
        period: RankingPeriod.weekly,
        ageRating: SeriesAgeRating.all,
        locale: 'en',
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

  test('listRelatedSeries asks about a series by its internal id', () async {
    server.relatedSeries = {
      ConnectFixtureServer.seedSeriesId: ['series-kitchen'],
    };

    final related = await catalog.listRelatedSeries(
      ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
      limit: 10,
      locale: 'en',
    );

    expect(related.map((item) => item.id), ['series-kitchen']);
    expect(related.single.title, 'The Little Kitchen');
    final request = server.requestsOf(pb.ListRelatedSeriesRequest.new).single;
    expect(
      request.seriesId,
      ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
    );
    expect(request.limit, 10);
    expect(request.surface, pb.ClientSurface.CLIENT_SURFACE_APP);
  });

  test('a series with nothing to go on to reads as an empty row', () async {
    final related = await catalog.listRelatedSeries(
      ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
      limit: 10,
      locale: 'en',
    );

    expect(related, isEmpty);
  });

  test('a series the API no longer shows reads as an empty row', () async {
    final related = await catalog.listRelatedSeries(
      ConnectFixtureServer.internalIdOf('missing'),
      limit: 10,
      locale: 'en',
    );

    expect(related, isEmpty);
  });

  test('a related row the API could not answer is a failure', () async {
    server.relatedStatus = HttpStatus.serviceUnavailable;

    expect(
      () => catalog.listRelatedSeries(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        limit: 10,
        locale: 'en',
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

  group('the recommendation orders', () {
    late HttpCatalogRepository signedIn;

    /// [count] published series, each with an id starting [prefix].
    List<pb.Series> order(String prefix, int count) => [
      for (var index = 1; index <= count; index++)
        server.series.first.deepCopy()
          ..publicId = '$prefix-$index'
          ..title = 'Series $prefix $index',
    ];

    setUp(() {
      server
        ..recommendedSeries = order('tenant', 3)
        ..myRecommendedSeries = order('reader', 3);
      signedIn = HttpCatalogRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: ConnectClient(
          baseUrl: server.baseUrl,
          accessToken: () => ConnectFixtureServer.memberAccessToken,
        ),
      );
    });

    List<String> idsOf(SeriesPage page) => [
      for (final series in page.series) series.id,
    ];

    test(
      'listRecommendedSeries reads the tenant order a page at a time',
      () async {
        final first = await catalog.listRecommendedSeries(
          limit: 2,
          locale: 'en',
        );
        final second = await catalog.listRecommendedSeries(
          limit: 2,
          token: first.nextToken,
          locale: 'en',
        );

        expect(idsOf(first), ['tenant-1', 'tenant-2']);
        expect(idsOf(second), ['tenant-3']);
        expect(second.nextToken, isEmpty);
        final requests = server.requestsOf(pb.ListRecommendedSeriesRequest.new);
        expect(requests.first.limit, 2);
        expect(requests.first.hasToken(), isFalse);
        expect(requests.last.token, first.nextToken);
      },
    );

    test('listMyRecommendedSeries reads the order the API answers the '
        'member', () async {
      final page = await signedIn.listMyRecommendedSeries(
        limit: 10,
        locale: 'en',
      );

      expect(idsOf(page), ['reader-1', 'reader-2', 'reader-3']);
      final request = server.requestsTo('ListMyRecommendedSeries').single;
      expect(
        request.headers[HttpHeaders.authorizationHeader],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
      expect(
        request.decode(pb.ListMyRecommendedSeriesRequest()).surface,
        pb.ClientSurface.CLIENT_SURFACE_APP,
      );
      expect(server.requestsTo('ListRecommendedSeries'), isEmpty);
    });

    test(
      'listMyRecommendedSeries reads the tenant order for a guest',
      () async {
        final page = await catalog.listMyRecommendedSeries(
          limit: 10,
          locale: 'en',
        );

        expect(idsOf(page), ['tenant-1', 'tenant-2', 'tenant-3']);
        expect(server.requestsTo('ListMyRecommendedSeries'), isEmpty);
      },
    );

    test('listMyRecommendedSeries reads the tenant order for a session the '
        'API refuses', () async {
      server.activeAccessToken = 'another-token';

      final page = await signedIn.listMyRecommendedSeries(
        limit: 10,
        locale: 'en',
      );

      expect(idsOf(page), ['tenant-1', 'tenant-2', 'tenant-3']);
      expect(server.requestsTo('ListMyRecommendedSeries'), hasLength(1));
      expect(server.requestsTo('ListRecommendedSeries'), hasLength(1));
    });

    test('an empty catalog reads as an empty order', () async {
      server.recommendedSeries = const [];

      final page = await catalog.listRecommendedSeries(limit: 10, locale: 'en');

      expect(page.series, isEmpty);
      expect(page.nextToken, isEmpty);
    });
  });

  test('listSeries resolves cover renditions against the image base', () async {
    final items = (await catalog.listSeries(locale: 'en')).series;

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
    final items = (await catalog.listSeries(locale: 'en')).series;

    // An eye-catch is the same image for every reader, so the request that
    // fetches it names only the tenant.
    expect(items.first.imageRequestHeaders, {'x-forwarded-host': 'localhost'});
  });

  test('listSeries reads a series without a cover as carrying none', () async {
    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.last.eyeCatchVariants, isEmpty);
  });

  test(
    'listSeries carries the credits in the order the API sent them',
    () async {
      final items = (await catalog.listSeries(locale: 'en')).series;

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
      pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
        creators: [
          pb.Creator(publicId: 'SeedAUTHAAA1', name: 'Seed Author 001'),
        ],
      ),
    ];

    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.first.creators.single.roleName, isEmpty);
  });

  test(
    'listSeries reads a series credited to nobody as carrying none',
    () async {
      final items = (await catalog.listSeries(locale: 'en')).series;

      expect(items.last.creators, isEmpty);
    },
  );

  test('listSeries drops a credit with no name', () async {
    server.series = [
      pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
        creators: [
          pb.Creator(publicId: 'SeedAUTHAAA1', name: ''),
          pb.Creator(publicId: 'SeedAUTHAAA2', name: 'Seed Author 002'),
        ],
      ),
    ];

    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.first.creators.map((creator) => creator.name), [
      'Seed Author 002',
    ]);
  });

  test('getSeries carries the credits of the series', () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(detail!.series.creators.map((creator) => creator.name), [
      'Seed Author 001',
      'Seed Author 002',
      'Seed Author 003',
    ]);
  });

  test("getSeries carries each episode's own eye-catch", () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    final episodes = {
      for (final episode in detail!.episodes) episode.id: episode,
    };
    // An episode without artwork of its own is read as carrying none, and the
    // series' cover stands in for it on screen.
    expect(
      episodes[ConnectFixtureServer.seedEpisodeId]!.eyeCatchVariants,
      isEmpty,
    );
    final variants =
        episodes[ConnectFixtureServer.paidEpisodeId]!.eyeCatchVariants;
    expect(variants.map((variant) => variant.url.toString()), [
      for (final width in [400, 800])
        '${server.baseUrl}/images/episode-eye-catches/'
            '${ConnectFixtureServer.paidEpisodeImageId}/landscape/$width',
    ]);
    expect(variants.first.variantType, 'landscape');
    expect((variants.first.width, variants.first.height), (400, 225));
  });

  test('listSeries carries status, schedule, and genres', () async {
    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.first.status, SeriesStatus.ongoing);
    expect(items.first.scheduleWeekdays, [1, 4]);
    expect(items.first.genres.single.name, 'Fantasy');
    expect(items.first.genres.single.id, 'SeedGENRAAA1');
    expect(items.first.ageRating, isNull);
    expect(items.last.status, isNull);
    expect(items.last.genres, isEmpty);
  });

  test('listSeries carries the tags of a series', () async {
    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.first.tags.single.slug, 'time-travel');
    expect(items.first.tags.single.name, 'Time travel');
    expect(items.last.tags, isEmpty);
  });

  test('listSeries drops a tag with no slug or no name', () async {
    server.series = [
      ConnectFixtureServer.populatedSeries().first
        ..tags.clear()
        ..tags.addAll([
          pb.Tag(name: 'Nameless slug', slug: ''),
          pb.Tag(name: '', slug: 'no-name'),
          pb.Tag(name: 'Slow burn', slug: 'slow-burn'),
        ]),
    ];

    final tags = (await catalog.listSeries(locale: 'en')).series.single.tags;

    expect(tags.single.slug, 'slow-burn');
  });

  test('getSeries carries the classification of the series', () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(detail!.series.status, SeriesStatus.ongoing);
    expect(detail.series.scheduleWeekdays, [1, 4]);
    expect(detail.series.genres.single.name, 'Fantasy');
  });

  test('listSeries maps a restricted age rating', () async {
    server.series = [
      pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
        ageRating: pb.SeriesAgeRating.SERIES_AGE_RATING_R15,
      ),
    ];

    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.single.ageRating, SeriesAgeRating.r15);
  });

  test('listSeries maps an unrecognized age rating as unknown', () async {
    server.listResponse = pb.ListPublishedSeriesResponse(
      series: [
        withUnnamedEnum(
          pb.Series(
            publicId: ConnectFixtureServer.seedSeriesId,
            title: ConnectFixtureServer.seedSeriesTitle,
          ),
          _seriesAgeRatingField,
        ),
      ],
    );

    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.single.ageRating, SeriesAgeRating.unknown);
  });

  test('listSeries drops a genre with no name or public id', () async {
    server.series = [
      pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
        genres: [
          pb.Genre(publicId: '', name: 'Fantasy'),
          pb.Genre(publicId: 'SeedGENRAAA2', name: ''),
          pb.Genre(publicId: 'SeedGENRAAA1', name: 'Fantasy'),
        ],
      ),
    ];

    final items = (await catalog.listSeries(locale: 'en')).series;

    expect(items.single.genres.single.name, 'Fantasy');
    expect(items.single.genres.single.id, 'SeedGENRAAA1');
  });

  test(
    'listSeries drops a weekday that is not Sunday through Saturday',
    () async {
      server.series = [
        pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
          scheduleWeekdays: [1, 9, 4],
        ),
      ];

      final items = (await catalog.listSeries(locale: 'en')).series;

      expect(items.single.scheduleWeekdays, [1, 4]);
    },
  );

  test('getEpisode carries the series age rating', () async {
    server.episodes = {
      ConnectFixtureServer.seedEpisodeId: pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: ConnectFixtureServer.seedEpisodeId,
          title: ConnectFixtureServer.seedEpisodeTitle,
          orderIndex: 1,
          price: 0,
        ),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
          ageRating: pb.SeriesAgeRating.SERIES_AGE_RATING_R18,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      ),
    };

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.ageRating, SeriesAgeRating.r18);
  });

  test('getSeries carries the internal ids the API answers with', () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(
      detail!.series.internalId,
      ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
    );
    expect(
      detail.episodes.first.internalId,
      ConnectFixtureServer.internalIdOf(detail.episodes.first.id),
    );
  });

  test('getSeries carries the cover renditions of the series', () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(detail!.series.eyeCatchVariants, hasLength(5));
    expect(detail.series.imageRequestHeaders, {
      'x-forwarded-host': 'localhost',
    });
  });

  test('listSeries rejects a cover rendition without a url', () async {
    server.series = [
      pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
        eyeCatchImageVariants: [
          pb.SeriesEyeCatchVariant(
            variantType: 'portrait',
            width: 400,
            height: 533,
          ),
        ],
      ),
    ];

    expect(
      () => catalog.listSeries(locale: 'en'),
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
    expect((await catalog.listSeries(locale: 'en')).series, isEmpty);
  });

  test('listSeries accepts an omitted empty repeated field', () async {
    server.listResponse = pb.ListPublishedSeriesResponse();
    expect((await catalog.listSeries(locale: 'en')).series, isEmpty);
  });

  test('getSeries returns detail and episode count', () async {
    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );
    expect(detail, isNotNull);
    expect(detail!.series.title, ConnectFixtureServer.seedSeriesTitle);
    expect(detail.series.episodeCount, 2);
    expect(detail.episodes.first.title, ConnectFixtureServer.seedEpisodeTitle);
    expect(detail.episodes.last.price, 500);
  });

  test('getSeries carries until when a free window holds an episode', () async {
    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..episodes.last.freeUntil = '2026-10-12T14:59:00Z';

    final read = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(read!.episodes.first.freeUntil, isNull);
    final windowed = read.episodes.last;
    expect(windowed.price, 500);
    expect(
      windowed.freeUntil!.isAtSameMomentAs(DateTime.utc(2026, 10, 12, 14, 59)),
      isTrue,
    );
    expect(windowed.isFreeAt(DateTime.utc(2026, 10, 12, 14, 58)), isTrue);
    expect(windowed.isFreeAt(DateTime.utc(2026, 10, 12, 14, 59)), isFalse);
  });

  test('getSeries carries what renting an episode costs', () async {
    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..episodes.last.rentalPrice = 200
          ..episodes.last.rentalPeriodHours = 48;

    final read = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(read!.episodes.first.isRented, isFalse);
    final rented = read.episodes.last;
    expect(rented.price, 500);
    expect(rented.rentalPrice, 200);
    expect(rented.rentalPeriodHours, 48);
    expect(rented.isRented, isTrue);
  });

  test('getSeries carries the campaign price open on an episode', () async {
    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..episodes.last.campaignPrice = 300
          ..episodes.last.campaignEndsAt = '2026-10-12T14:59:00Z';

    final read = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    // The wire format omits both where no campaign is open.
    expect(read!.episodes.first.campaign, isNull);
    final discounted = read.episodes.last;
    expect(discounted.price, 500);
    expect(discounted.campaign!.price, 300);
    expect(
      discounted.campaign!.endsAt.isAtSameMomentAs(
        DateTime.utc(2026, 10, 12, 14, 59),
      ),
      isTrue,
    );
    expect(
      discounted.campaignAt(DateTime.utc(2026, 10, 12, 14, 58)),
      isNotNull,
    );
    expect(discounted.campaignAt(DateTime.utc(2026, 10, 12, 14, 59)), isNull);
  });

  test('getSeries reads a campaign with no end as none', () async {
    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..episodes.last.campaignPrice = 300;

    final read = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(read!.episodes.last.campaign, isNull);
  });

  test('getSeries carries the wait-for-free rule of the series', () async {
    expect(
      (await catalog.getSeries(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      ))!.waitFree,
      isNull,
    );

    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..waitFree = pb.WaitFreeRule(
            rechargeHours: 23,
            accessHours: 72,
            excludedLatestCount: 1,
            excludedEpisodeIds: ['internal-SeedEPSDAA1A'],
          );

    final rule = (await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    ))!.waitFree!;
    expect(rule.rechargeHours, 23);
    expect(rule.accessHours, 72);
    expect(rule.covers('internal-SeedEPSDAA1A'), isFalse);
    expect(
      rule.covers('internal-${ConnectFixtureServer.seedEpisodeId}'),
      isTrue,
    );
  });

  test('getSeries carries the volumes on sale in their order', () async {
    expect(
      (await catalog.getSeries(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      ))!.volumes,
      isEmpty,
    );

    server.detailResponse =
        ConnectFixtureServer.populatedDetails()[ConnectFixtureServer
              .seedSeriesId]!
          ..volumes.addAll([
            pb.Volume(
              id: 'volume-2',
              publicId: 'VOLUME000002',
              title: 'Volume 2',
              orderIndex: 2,
              price: 700,
              episodeIds: ['internal-EP03'],
            ),
            pb.Volume(
              id: 'volume-1',
              publicId: 'VOLUME000001',
              title: 'Volume 1',
              orderIndex: 1,
              price: 350,
              episodeIds: ['internal-EP01', 'internal-EP02'],
              coverImageVariants: [
                pb.SeriesEyeCatchVariant(
                  variantType: 'portrait',
                  url: '/volumes/VOLUME000001/portrait.webp',
                  width: 600,
                  height: 800,
                ),
              ],
            ),
          ]);

    final [first, second] = (await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    ))!.volumes;
    expect(first.id, 'volume-1');
    expect(first.publicId, 'VOLUME000001');
    expect(first.title, 'Volume 1');
    expect(first.price, 350);
    expect(first.episodeIds, ['internal-EP01', 'internal-EP02']);
    expect(first.coverVariants.single.variantType, 'portrait');
    expect(second.publicId, 'VOLUME000002');
    expect(second.coverVariants, isEmpty);
  });

  test('getSeries returns null for a missing public id', () async {
    expect(await catalog.getSeries('ZZZZZZZZZZZZ', locale: 'en'), isNull);
  });

  test('getSeriesTitle names the series a follow row stands for, and the '
      'locale its title was served in', () async {
    server.details[ConnectFixtureServer.seedSeriesId]!.series.locale = 'ja';

    expect(
      await catalog.getSeriesTitle(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      ),
      (title: ConnectFixtureServer.seedSeriesTitle, locale: 'ja'),
    );
  });

  test('getSeriesTitle returns null for a series nothing publishes', () async {
    expect(await catalog.getSeriesTitle('ZZZZZZZZZZZZ', locale: 'en'), isNull);
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

      final request = server
          .requestsOf(pb.SearchPublishedCreatorsRequest.new)
          .single;
      expect(request.query, 'author 002');
      expect(request.limit, 20);
      expect(request.hasToken(), isFalse);
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
    final request = server
        .requestsOf(pb.SearchPublishedCreatorsRequest.new)
        .last;
    expect(request.token, first.nextToken);
    expect(request.query, 'Seed Author');
  });

  test('searchCreators resolves a portrait against the image base', () async {
    server.series = [
      pb.Series(
        publicId: 'series-portrait',
        title: 'Portrait',
        creators: [
          pb.Creator(
            publicId: 'author-portrait',
            name: 'Portrait Author',
            iconImageUrl: '/images/creators/portrait',
          ),
        ],
      ),
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
      server.requestsOf(pb.SearchPublishedLabelsRequest.new).single.query,
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

  test(
    'listCreators maps every credited author onto PublishedCreator',
    () async {
      final page = await catalog.listCreators();

      expect(page.creators.map((creator) => creator.id), [
        'SeedAUTHAAA1',
        'SeedAUTHAAA2',
        'SeedAUTHAAA3',
      ]);
      expect(page.creators.first.name, 'Seed Author 001');
      expect(page.creators.first.seriesCount, 1);
      expect(page.nextToken, isEmpty);

      final request = server
          .requestsOf(pb.ListPublishedCreatorsRequest.new)
          .single;
      expect(request.limit, 20);
      expect(request.surface, pb.ClientSurface.CLIENT_SURFACE_APP);
      expect(request.hasToken(), isFalse);
    },
  );

  test('listCreators asks for the limit and the page it is given', () async {
    server.seriesPageSize = 2;

    final first = await catalog.listCreators(limit: 2);
    final second = await catalog.listCreators(limit: 2, token: first.nextToken);

    expect(second.creators.single.id, 'SeedAUTHAAA3');
    expect(second.nextToken, isEmpty);
    final request = server.requestsOf(pb.ListPublishedCreatorsRequest.new).last;
    expect(request.limit, 2);
    expect(request.token, first.nextToken);
  });

  test('listLabels maps every label onto PublishedLabel', () async {
    final page = await catalog.listLabels();

    final label = page.labels.single;
    expect(label.id, 'SeedLABLAAA1');
    expect(label.name, 'Seed Label 01');
    expect(page.nextToken, isEmpty);
    expect(
      server.requestsOf(pb.ListPublishedLabelsRequest.new).single.limit,
      20,
    );
  });

  test(
    'listCreators and listLabels read a tenant with none as empty',
    () async {
      server.series = const [];

      expect((await catalog.listCreators()).creators, isEmpty);
      expect((await catalog.listLabels()).labels, isEmpty);
    },
  );

  test('an author or label list the API could not answer is a network '
      'failure', () async {
    server.directoryStatus = HttpStatus.serviceUnavailable;
    final isNetwork = throwsA(
      isA<CatalogFailure>().having(
        (error) => error.kind,
        'kind',
        CatalogFailureKind.network,
      ),
    );

    expect(() => catalog.listCreators(), isNetwork);
    expect(() => catalog.listLabels(), isNetwork);
  });

  test('getCreatorDetail carries the author and their series', () async {
    final detail = await catalog.getCreatorDetail('SeedAUTHAAA1', locale: 'en');

    expect(detail, isNotNull);
    expect(detail!.creator.name, 'Seed Author 001');
    expect(detail.creator.seriesCount, 1);
    expect(detail.series.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(detail.series.nextToken, isEmpty);

    final request = server
        .requestsOf(pb.GetPublishedCreatorDetailRequest.new)
        .single;
    expect(request.publicId, 'SeedAUTHAAA1');
    expect(request.limit, 20);
    expect(request.hasToken(), isFalse);
  });

  test('getCreatorDetail asks for the page its token names', () async {
    server.seriesPageSize = 1;
    server.series = [
      ...ConnectFixtureServer.populatedSeries(),
      pb.Series(
        publicId: 'series-second',
        title: 'Second Series',
        creators: ConnectFixtureServer.seedCreators(),
      ),
    ];

    final first = await catalog.getCreatorDetail('SeedAUTHAAA1', locale: 'en');
    final second = await catalog.getCreatorDetail(
      'SeedAUTHAAA1',
      token: first!.series.nextToken,
      locale: 'en',
    );

    expect(first.series.nextToken, isNotEmpty);
    expect(second!.series.series.single.id, 'series-second');
    expect(
      server.requestsOf(pb.GetPublishedCreatorDetailRequest.new).last.token,
      first.series.nextToken,
    );
  });

  test(
    'getCreatorDetail returns null for an author the API does not know',
    () async {
      expect(
        await catalog.getCreatorDetail('ZZZZZZZZZZZZ', locale: 'en'),
        isNull,
      );
    },
  );

  test('getLabelDetail carries the label and its series', () async {
    final detail = await catalog.getLabelDetail('SeedLABLAAA1', locale: 'en');

    expect(detail, isNotNull);
    expect(detail!.label.name, 'Seed Label 01');
    expect(detail.label.seriesCount, 1);
    expect(detail.series.series.single.id, ConnectFixtureServer.seedSeriesId);
    expect(
      server.requestsOf(pb.GetPublishedLabelDetailRequest.new).single.publicId,
      'SeedLABLAAA1',
    );
  });

  test(
    'getLabelDetail returns null for a label the API does not know',
    () async {
      expect(
        await catalog.getLabelDetail('ZZZZZZZZZZZZ', locale: 'en'),
        isNull,
      );
    },
  );

  test(
    'listCampaignBanners answers the banners showing now, in order',
    () async {
      server.campaignBanners = [
        pb.CampaignBanner(
          publicId: 'SeedBANRAAA2',
          linkUrl: ' /labels/SeedLABLAAA1 ',
          altText: ' Summer sale, up to 50% off through August 31 ',
          imageVariants: [
            pb.SeriesEyeCatchVariant(
              variantType: 'landscape',
              url: '/images/campaign-banners/banner-2/landscape/800',
              width: 800,
              height: 450,
            ),
          ],
        ),
        pb.CampaignBanner(
          publicId: 'SeedBANRAAA1',
          linkUrl: 'https://example.com/campaign',
        ),
      ];

      final banners = await catalog.listCampaignBanners();

      expect(
        [for (final banner in banners) banner.id],
        ['SeedBANRAAA2', 'SeedBANRAAA1'],
      );
      expect(banners.first.linkUrl, '/labels/SeedLABLAAA1');
      expect(
        banners.first.altText,
        'Summer sale, up to 50% off through August 31',
      );
      // A banner the operator wrote no words for carries none.
      expect(banners.last.altText, isEmpty);
      final variant = banners.first.imageVariants.single;
      expect(variant.variantType, 'landscape');
      expect(
        variant.url.toString(),
        '${server.baseUrl}/images/campaign-banners/banner-2/landscape/800',
      );
      expect(banners.first.imageRequestHeaders, {
        'x-forwarded-host': 'localhost',
      });
      // The wire format omits an empty repeated field, which is a banner
      // whose image has no rendition left.
      expect(banners.last.imageVariants, isEmpty);
      final request = server
          .requestsOf(pb.ListCampaignBannersRequest.new)
          .single;
      expect(request.tenant.tenantId, ConnectFixtureServer.defaultTenantId);
    },
  );

  test('listCampaignBanners answers nothing scheduled as empty', () async {
    expect(await catalog.listCampaignBanners(), isEmpty);
  });

  test('listGenres reads every page of genres, counted', () async {
    server
      ..genres = ConnectFixtureServer.populatedGenres()
      ..seriesPageSize = 1;

    final genres = await catalog.listGenres(locale: 'en');

    expect(
      [for (final genre in genres) genre.id],
      ['SeedGENRAAA1', 'SeedGENRAAA2'],
    );
    expect(genres.first.name, 'Fantasy');
    expect(genres.first.seriesCount, 1);
    // A genre nothing published carries is listed at zero.
    expect(genres.last.seriesCount, 0);
    final requests = server.requestsOf(pb.ListPublishedGenresRequest.new);
    expect(requests, hasLength(2));
    expect(requests.first.limit, 100);
    expect(requests.first.surface, pb.ClientSurface.CLIENT_SURFACE_APP);
    expect(requests.last.token, '1');
  });

  test(
    'listGenres carries each genre\'s covers in the order they came',
    () async {
      server.genres = [
        publishedGenreOf(
          ConnectFixtureServer.seedGenres().first,
          featuredSeries: [
            pb.PublishedGenreFeaturedSeries(
              publicId: ConnectFixtureServer.seedSeriesId,
              title: ConnectFixtureServer.seedSeriesTitle,
              eyeCatchImageVariants:
                  ConnectFixtureServer.seedEyeCatchVariants(),
            ),
            pb.PublishedGenreFeaturedSeries(
              publicId: 'series-kitchen',
              title: 'The Little Kitchen',
            ),
          ],
        ),
        pb.PublishedGenre(
          publicId: 'SeedGENRAAA2',
          name: 'Romance',
          slug: 'romance',
        ),
      ];

      final genres = await catalog.listGenres(locale: 'en');

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
      // The wire format omits an empty repeated field, which is a genre with
      // none.
      expect(genres.last.featuredSeries, isEmpty);
    },
  );

  test(
    'listGenres carries the eye-catch uploaded for a genre, and none for one '
    'without',
    () async {
      server.genres = [
        publishedGenreOf(
          ConnectFixtureServer.seedGenres().first,
          eyeCatchImageVariants: [
            pb.SeriesEyeCatchVariant(
              label: 'portrait_600w',
              variantType: 'portrait',
              url: '/images/genres/SeedGENRAAA1/portrait/600',
              contentType: 'image/webp',
              width: 600,
              height: 800,
            ),
          ],
        ),
        pb.PublishedGenre(
          publicId: 'SeedGENRAAA2',
          name: 'Romance',
          slug: 'romance',
        ),
      ];

      final genres = await catalog.listGenres(locale: 'en');

      final eyeCatch = genres.first.eyeCatchVariants.single;
      expect(eyeCatch.variantType, 'portrait');
      expect(
        eyeCatch.url.toString(),
        '${server.baseUrl}/images/genres/SeedGENRAAA1/portrait/600',
      );
      expect(eyeCatch.width, 600);
      // The wire format omits an empty repeated field, which is a genre with
      // none.
      expect(genres.last.eyeCatchVariants, isEmpty);
    },
  );

  test('listGenres drops a cover that names no series', () async {
    server.genres = [
      publishedGenreOf(
        ConnectFixtureServer.seedGenres().first,
        featuredSeries: [
          pb.PublishedGenreFeaturedSeries(publicId: '  ', title: 'Nameless'),
          pb.PublishedGenreFeaturedSeries(
            publicId: 'series-kitchen',
            title: 'The Little Kitchen',
          ),
        ],
      ),
    ];

    final genres = await catalog.listGenres(locale: 'en');

    expect(
      [for (final series in genres.single.featuredSeries) series.id],
      ['series-kitchen'],
    );
  });

  test('listGenres reads a tenant with no genre as empty', () async {
    expect(await catalog.listGenres(locale: 'en'), isEmpty);
  });

  test('getTag walks the tags until the slug turns up', () async {
    server
      ..seriesPageSize = 1
      ..series = [
        ConnectFixtureServer.populatedSeries().first
          ..tags.clear()
          ..tags.addAll([
            pb.Tag(name: 'Found family', slug: 'found-family'),
            pb.Tag(name: 'Time travel', slug: 'time-travel'),
          ]),
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
      locale: 'en',
    );

    expect(page!.series.single.id, ConnectFixtureServer.seedSeriesId);
    final body = server.requestsOf(pb.ListPublishedSeriesRequest.new).single;
    expect(body.genrePublicId, 'SeedGENRAAA1');
    expect(body.order, pb.SeriesOrder.SERIES_ORDER_LATEST_EPISODE_AT_DESC);
    expect(body.status, pb.SeriesStatus.SERIES_STATUS_ONGOING);
    expect(body.hasFreeEpisodes, isTrue);
    expect(body.surface, pb.ClientSurface.CLIENT_SURFACE_APP);
    expect(body.hasTagSlug(), isFalse);
  });

  test('listGenreSeries leaves an unnarrowed list to the newest', () async {
    server.genres = ConnectFixtureServer.populatedGenres();

    await catalog.listGenreSeries('SeedGENRAAA1', locale: 'en');

    final body = server.requestsOf(pb.ListPublishedSeriesRequest.new).single;
    expect(body.order, pb.SeriesOrder.SERIES_ORDER_PUBLISHED_AT_DESC);
    // The wire format omits a default, and an omitted filter keeps everything.
    expect(body.hasStatus(), isFalse);
    expect(body.hasHasFreeEpisodes(), isFalse);
    expect(body.hasToken(), isFalse);
  });

  test(
    'listGenreSeries returns null for a genre the API does not know',
    () async {
      expect(
        await catalog.listGenreSeries('ZZZZZZZZZZZZ', locale: 'en'),
        isNull,
      );
    },
  );

  test('listTagSeries asks for the page its token names', () async {
    server
      ..seriesPageSize = 1
      ..series = [
        for (final item in ConnectFixtureServer.populatedSeries())
          item
            ..tags.clear()
            ..tags.addAll(ConnectFixtureServer.seedTags()),
      ];
    final first = await catalog.listTagSeries('time-travel', locale: 'en');

    final second = await catalog.listTagSeries(
      'time-travel',
      token: first!.nextToken,
      locale: 'en',
    );

    expect(second!.series.single.id, 'series-kitchen');
    final body = server.requestsOf(pb.ListPublishedSeriesRequest.new).last;
    expect(body.tagSlug, 'time-travel');
    expect(body.token, first.nextToken);
  });

  test('listTagSeries returns null for a tag the API does not know', () async {
    expect(await catalog.listTagSeries('missing', locale: 'en'), isNull);
  });

  test('listSeries carries the public id of the label', () async {
    final page = await catalog.listSeries(locale: 'en');

    expect(page.series.first.labelId, 'SeedLABLAAA1');
    expect(page.series.first.labelName, 'Seed Label 01');
  });

  test('listSeries maps transport failure to CatalogFailure.network', () async {
    server.listStatus = HttpStatus.serviceUnavailable;
    expect(
      () => catalog.listSeries(locale: 'en'),
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
    server.listResponse = undecodableBody;

    expect(
      () => catalog.listSeries(locale: 'en'),
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
    server.detailResponse = pb.GetSeriesDetailResponse(
      series: pb.Series(title: 'Missing public id'),
    );

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en'),
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
      locale: 'en',
    );

    expect(detail, isNotNull);
    expect(detail!.access, EpisodeAccess.free);
    expect(detail.episode.title, ConnectFixtureServer.seedEpisodeTitle);
    expect(detail.seriesTitle, ConnectFixtureServer.seedSeriesTitle);
    expect(detail.images, hasLength(ConnectFixtureServer.seedEpisodePageCount));
    expect(detail.images.first.width, 800);
    expect(detail.images.first.height, 1200);
  });

  test(
    "getEpisode carries the episode's own eye-catch and its series'",
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: ConnectFixtureServer.paidEpisodeId,
          title: 'Seed Episode 001-10',
          orderIndex: 10,
          price: 500,
          eyeCatchImageVariants:
              ConnectFixtureServer.paidEpisodeEyeCatchVariants(),
        ),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
          eyeCatchImageVariants: ConnectFixtureServer.seedEyeCatchVariants(),
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_LOCKED,
      );

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.paidEpisodeId,
        locale: 'en',
      );

      expect(
        detail!.episode.eyeCatchVariants.first.url.toString(),
        '${server.baseUrl}/images/episode-eye-catches/'
        '${ConnectFixtureServer.paidEpisodeImageId}/landscape/400',
      );
      // What a saved copy of an episode without artwork of its own draws.
      expect(
        detail.seriesEyeCatchVariants,
        hasLength(ConnectFixtureServer.seedEyeCatchVariants().length),
      );
    },
  );

  test('getEpisode resolves image paths against the image base url', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
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
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Paid', price: 500),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED,
      images: [
        pb.EpisodeImage(
          id: 'page-1',
          imageUrl: '/images/episodes/page-1?t=token-value',
        ),
      ],
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.access, EpisodeAccess.entitled);
    expect(detail.images.single.url.queryParameters['t'], 'token-value');
  });

  test('getEpisode reads why an entitled reader may open the body', () async {
    pb.GetEpisodeDetailResponse entitled([
      pb.EpisodeEntitlementSource? source,
    ]) => pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Paid', price: 500),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED,
      entitlementSource: source,
    );
    Future<EpisodeDetail?> read(Object response) {
      server.episodeResponse = response;
      return catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );
    }

    expect(
      (await read(
        entitled(
          pb.EpisodeEntitlementSource.EPISODE_ENTITLEMENT_SOURCE_CREATOR,
        ),
      ))!.entitlementSource,
      EpisodeEntitlementSource.creator,
    );
    expect(
      (await read(
        entitled(
          pb.EpisodeEntitlementSource.EPISODE_ENTITLEMENT_SOURCE_PURCHASE,
        ),
      ))!.entitlementSource,
      EpisodeEntitlementSource.purchase,
    );
    expect(
      (await read(
        entitled(
          pb.EpisodeEntitlementSource.EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET,
        ),
      ))!.entitlementSource,
      EpisodeEntitlementSource.accessTicket,
    );
    // The wire format omits the zero value, and a value this build does not
    // know is read the same way: the body still opens as entitled.
    expect(
      (await read(entitled()))!.entitlementSource,
      EpisodeEntitlementSource.unspecified,
    );
    final unknown = await read(
      withUnnamedEnum(entitled(), _episodeEntitlementSourceField),
    );
    expect(unknown!.access, EpisodeAccess.entitled);
    expect(unknown.entitlementSource, EpisodeEntitlementSource.unspecified);
  });

  test('getEpisode orders pages by displayOrder', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Shuffled'),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      images: [
        pb.EpisodeImage(
          id: 'b',
          imageUrl: '/images/episodes/b',
          displayOrder: 2,
        ),
        pb.EpisodeImage(
          id: 'a',
          imageUrl: '/images/episodes/a',
          displayOrder: 1,
        ),
      ],
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.images.map((image) => image.id), ['a', 'b']);
  });

  test('getEpisode carries the episodes either side of this one', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Middle', orderIndex: 2),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      previousEpisode: pb.EpisodeNeighbor(
        publicId: 'EP01',
        title: 'First',
        orderIndex: 1,
        isFree: true,
      ),
      nextEpisode: pb.EpisodeNeighbor(
        publicId: 'EP03',
        title: 'Third',
        orderIndex: 3,
        price: 500,
      ),
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.previousEpisode!.id, 'EP01');
    expect(detail.previousEpisode!.isFree, isTrue);
    expect(detail.nextEpisode!.title, 'Third');
    expect(detail.nextEpisode!.price, 500);
    // The wire format omits a false, so a paid neighbour arrives without the
    // field.
    expect(detail.nextEpisode!.isFree, isFalse);
    expect(detail.nextEpisode!.campaign, isNull);
  });

  test('getEpisode carries the campaign open on a neighbour', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(
        publicId: 'EP',
        title: 'Middle',
        orderIndex: 2,
        price: 500,
        campaignPrice: 300,
        campaignEndsAt: '2026-10-12T14:59:00Z',
      ),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_LOCKED,
      nextEpisode: pb.EpisodeNeighbor(
        publicId: 'EP03',
        title: 'Third',
        orderIndex: 3,
        price: 500,
        campaignPrice: 250,
        campaignEndsAt: '2026-10-13T14:59:00Z',
      ),
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.episode.campaign!.price, 300);
    final next = detail.nextEpisode!.campaign!;
    expect(next.price, 250);
    expect(
      next.endsAt.isAtSameMomentAs(DateTime.utc(2026, 10, 13, 14, 59)),
      isTrue,
    );
  });

  test(
    'getEpisode reads where the episode and its neighbours are sold',
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: 'EP',
          title: 'Middle',
          orderIndex: 2,
          price: 300,
          purchaseAvailability: pb.SurfaceAvailability.SURFACE_AVAILABILITY_WEB,
        ),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_LOCKED,
        previousEpisode: pb.EpisodeNeighbor(
          publicId: 'EP01',
          title: 'First',
          orderIndex: 1,
          price: 300,
          purchaseAvailability: pb.SurfaceAvailability.SURFACE_AVAILABILITY_APP,
        ),
        nextEpisode: pb.EpisodeNeighbor(
          publicId: 'EP03',
          title: 'Third',
          orderIndex: 3,
          price: 300,
        ),
      );

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      expect(detail!.episode.purchaseSurface, EpisodePurchaseSurface.web);
      expect(
        detail.previousEpisode!.purchaseSurface,
        EpisodePurchaseSurface.app,
      );
      // The wire format omits unspecified, which is how every episode was sold
      // before the setting existed.
      expect(detail.nextEpisode!.purchaseSurface, EpisodePurchaseSurface.all);
    },
  );

  test('getEpisode reports no neighbour at the ends of the series', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    // The wire format omits an unset message, which is what the server sends
    // where there is no episode on that side.
    expect(detail!.previousEpisode, isNull);
    expect(detail.nextEpisode, isNull);
    expect(detail.nextFreeEpisode, isNull);
    expect(detail.previewImages, isEmpty);
  });

  test(
    'getEpisode hands a withheld body its preview and the next free episode',
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(publicId: 'EP', title: 'Paid', price: 300),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_LOCKED,
        previewImages: [
          pb.EpisodeImage(
            id: 'page-2',
            imageUrl: '/images/episodes/page-2/preview',
            displayOrder: 2,
            width: 45,
            height: 64,
          ),
          pb.EpisodeImage(
            id: 'page-1',
            imageUrl: '/images/episodes/page-1/preview',
            displayOrder: 1,
            width: 45,
            height: 64,
          ),
        ],
        nextFreeEpisode: pb.EpisodeNeighbor(
          publicId: 'EP05',
          title: 'Fifth',
          orderIndex: 5,
          isFree: true,
        ),
      );
      final authenticated = HttpCatalogRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: ConnectClient(
          baseUrl: server.baseUrl,
          accessToken: () => ConnectFixtureServer.memberAccessToken,
        ),
      );

      final detail = await authenticated.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      expect(detail!.images, isEmpty);
      expect(detail.previewImages.map((image) => image.id), [
        'page-1',
        'page-2',
      ]);
      expect(
        detail.previewImages.first.url.toString(),
        '${server.baseUrl}/images/episodes/page-1/preview',
      );
      expect(detail.previewImages.first.width, 45);
      expect(detail.previewImages.first.height, 64);
      // A preview is the same for every reader, so the session that read the
      // body stays off its requests.
      expect(detail.previewImageRequestHeaders, {
        'x-forwarded-host': 'localhost',
      });
      expect(detail.nextFreeEpisode!.id, 'EP05');
      expect(detail.nextFreeEpisode!.orderIndex, 5);
      expect(detail.nextFreeEpisode!.isFree, isTrue);
    },
  );

  test(
    'getEpisode hands the viewer the episode\'s resolved reading direction and spread start',
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: 'EP',
          title: 'Left to right',
          readingDirection: pb.ReadingDirection.READING_DIRECTION_LEFT_TO_RIGHT,
          spreadStartIndex: 0,
        ),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      );

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      expect(detail!.readingDirection, ReadingDirection.ltr);
      expect(detail.spreadStartIndex, 0);
    },
  );

  test(
    'getEpisode reads an omitted direction as right to left and an omitted spread start as pairing from the first page',
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(publicId: 'EP', title: 'Omitted layout'),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      );

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      // The wire format omits unspecified and zero. Unspecified is the series
      // default of right to left; zero is pairing from the first page.
      expect(detail!.readingDirection, ReadingDirection.rtl);
      expect(detail.spreadStartIndex, 0);
    },
  );

  test(
    'getEpisode reads a never-edited series as right to left from the cover',
    () async {
      server.episodeResponse = pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: 'EP',
          title: 'Never edited',
          readingDirection: pb.ReadingDirection.READING_DIRECTION_RIGHT_TO_LEFT,
          spreadStartIndex: 1,
        ),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
        access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      );

      final detail = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      expect(detail!.readingDirection, ReadingDirection.rtl);
      expect(detail.spreadStartIndex, 1);
    },
  );

  test('getEpisode carries the credits of the episode itself', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
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
        locale: 'en',
      );

      expect(detail!.creators, isEmpty);
    },
  );

  test('getEpisode reports a locked paid body with no pages', () async {
    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
      locale: 'en',
    );

    expect(detail!.access, EpisodeAccess.locked);
    expect(detail.images, isEmpty);
    expect(
      detail.seriesInternalId,
      ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
    );
  });

  test('getEpisode reports a body withheld over the reader\'s age', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Rated'),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_AGE_RESTRICTED,
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.access, EpisodeAccess.ageRestricted);
    expect(detail.images, isEmpty);
  });

  test('getEpisode returns null for a missing public id', () async {
    expect(
      await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        'ZZZZZZZZZZZZ',
        locale: 'en',
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
          locale: 'en',
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
        locale: 'en',
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
    'a tenant lookup answering with a body that does not decode is unexpected',
    () async {
      server.tenantResponse = undecodableBody;

      expect(
        catalog.listSeries(locale: 'en'),
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
      locale: 'en',
    );

    expect(detail!.imageRequestHeaders['x-forwarded-host'], 'localhost');
    expect(detail.imageRequestHeaders.containsKey('authorization'), isFalse);
  });

  test('an access token reaches both the API and the image routes', () async {
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
      locale: 'en',
    );
    expect(anonymous!.access, EpisodeAccess.locked);
    expect(anonymous.imageRequestHeaders.containsKey('authorization'), isFalse);

    accessToken = ConnectFixtureServer.memberAccessToken;
    final entitled = await authenticated.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.paidEpisodeId,
      locale: 'en',
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
      locale: 'en',
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
      await catalog.listSeries(locale: 'en');
      await catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en');
      await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      expect(server.requestsTo('GetTenantByDomain'), hasLength(1));
    },
  );

  test('every read carries the resolved tenant in header and body', () async {
    await catalog.listSeries(locale: 'en');
    await catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en');

    final list = server.requestsTo('ListPublishedSeries').single;
    expect(
      list.headers['x-publira-tenant-id'],
      ConnectFixtureServer.defaultTenantId,
    );
    final listBody = list.decode(pb.ListPublishedSeriesRequest());
    expect(listBody.limit, 20);
    expect(
      listBody.tenant,
      pb.TenantContext(tenantId: ConnectFixtureServer.defaultTenantId),
    );

    final detail = server.requestsTo('GetSeriesDetail').single;
    expect(
      detail.headers['x-publira-tenant-id'],
      ConnectFixtureServer.defaultTenantId,
    );
    final detailBody = detail.decode(pb.GetSeriesDetailRequest());
    expect(detailBody.publicId, ConnectFixtureServer.seedSeriesId);
    expect(
      detailBody.tenant,
      pb.TenantContext(tenantId: ConnectFixtureServer.defaultTenantId),
    );
  });

  group('the surface the app names', () {
    const webOnly = ConnectFixtureServer.seedSeriesId;
    const appOnly = 'series-kitchen';

    setUp(() {
      server.seriesAvailability = {
        webOnly: pb.SurfaceAvailability.SURFACE_AVAILABILITY_WEB,
        appOnly: pb.SurfaceAvailability.SURFACE_AVAILABILITY_APP,
      };
      server.rankedSeries = [
        for (final (index, series) in server.series.indexed)
          pb.RankedSeries(rank: index + 1, series: series),
      ];
    });

    test('every catalog read names the app', () async {
      await catalog.listSeries(locale: 'en');
      await catalog.listNewestSeries(limit: 3, locale: 'en');
      await catalog.listRankedSeries(
        limit: 3,
        period: RankingPeriod.daily,
        ageRating: SeriesAgeRating.all,
        locale: 'en',
      );
      await catalog.searchSeries(query: 'Seed', locale: 'en');
      await catalog.searchCreators(query: 'Seed');
      await catalog.searchLabels(query: 'Seed');
      await catalog.listCreators();
      await catalog.listLabels();
      await catalog.getSeries(webOnly, locale: 'en');
      await catalog.getCreator('SeedAUTHAAA1');
      await catalog.getCreatorDetail('SeedAUTHAAA1', locale: 'en');
      await catalog.getLabelDetail('SeedLABLAAA1', locale: 'en');
      await catalog.getEpisode(
        webOnly,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );
      await catalog.listRecommendedSeries(limit: 3, locale: 'en');

      final reads = server.requests.where(
        (request) => request.path.contains('/publira.v1.CatalogService/'),
      );
      expect(
        {for (final read in reads) read.path.split('/').last},
        {
          'ListPublishedSeries',
          'ListRankedSeries',
          'ListRecommendedSeries',
          'SearchPublishedSeries',
          'SearchPublishedCreators',
          'SearchPublishedLabels',
          'ListPublishedCreators',
          'ListPublishedLabels',
          'GetSeriesDetail',
          'GetPublishedCreatorDetail',
          'GetPublishedLabelDetail',
          'GetEpisodeDetail',
        },
      );
      for (final read in reads) {
        final surface = switch (read.path.split('/').last) {
          'ListPublishedSeries' =>
            read.decode(pb.ListPublishedSeriesRequest()).surface,
          'ListRankedSeries' =>
            read.decode(pb.ListRankedSeriesRequest()).surface,
          'ListRecommendedSeries' =>
            read.decode(pb.ListRecommendedSeriesRequest()).surface,
          'SearchPublishedSeries' =>
            read.decode(pb.SearchPublishedSeriesRequest()).surface,
          'SearchPublishedCreators' =>
            read.decode(pb.SearchPublishedCreatorsRequest()).surface,
          'SearchPublishedLabels' =>
            read.decode(pb.SearchPublishedLabelsRequest()).surface,
          'ListPublishedCreators' =>
            read.decode(pb.ListPublishedCreatorsRequest()).surface,
          'ListPublishedLabels' =>
            read.decode(pb.ListPublishedLabelsRequest()).surface,
          'GetSeriesDetail' => read.decode(pb.GetSeriesDetailRequest()).surface,
          'GetPublishedCreatorDetail' =>
            read.decode(pb.GetPublishedCreatorDetailRequest()).surface,
          'GetPublishedLabelDetail' =>
            read.decode(pb.GetPublishedLabelDetailRequest()).surface,
          'GetEpisodeDetail' =>
            read.decode(pb.GetEpisodeDetailRequest()).surface,
          final procedure => fail('no request message for $procedure'),
        };
        expect(surface, pb.ClientSurface.CLIENT_SURFACE_APP, reason: read.path);
      }
    });

    test(
      'a series the storefront alone shows is left out of every list',
      () async {
        final ids = [
          for (final series in (await catalog.listSeries(locale: 'en')).series)
            series.id,
        ];
        final ranked = await catalog.listRankedSeries(
          limit: 3,
          period: RankingPeriod.weekly,
          ageRating: SeriesAgeRating.all,
          locale: 'en',
        );
        final searched = await catalog.searchSeries(
          query: 'Seed',
          locale: 'en',
        );

        expect(ids, [appOnly]);
        expect(
          [for (final item in ranked.rankedSeries) item.series.id],
          [appOnly],
        );
        expect(searched.series, isEmpty);
      },
    );

    test(
      'a series the storefront alone shows reads as missing, episodes too',
      () async {
        expect(await catalog.getSeries(webOnly, locale: 'en'), isNull);
        expect(
          await catalog.getEpisode(
            webOnly,
            ConnectFixtureServer.seedEpisodeId,
            locale: 'en',
          ),
          isNull,
        );
      },
    );

    test(
      'a label whose series the storefront alone shows still opens, empty',
      () async {
        final detail = await catalog.getLabelDetail(
          'SeedLABLAAA1',
          locale: 'en',
        );

        expect(detail, isNotNull);
        expect(detail!.label.seriesCount, 0);
        expect(detail.series.series, isEmpty);
      },
    );

    test('a series shown on both surfaces reads as it always has', () async {
      server.seriesAvailability = {
        webOnly: pb.SurfaceAvailability.SURFACE_AVAILABILITY_ALL,
      };

      expect(await catalog.getSeries(webOnly, locale: 'en'), isNotNull);
      expect(
        await catalog.getEpisode(
          webOnly,
          ConnectFixtureServer.seedEpisodeId,
          locale: 'en',
        ),
        isNotNull,
      );
      expect((await catalog.listSeries(locale: 'en')).series, hasLength(2));
    });
  });

  test('a failed tenant lookup is retried by the next read', () async {
    server.tenantStatus = HttpStatus.serviceUnavailable;
    server.tenantResponse = const {
      'code': 'unavailable',
      'message': 'domain service is down',
    };

    await expectLater(
      catalog.listSeries(locale: 'en'),
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

    expect((await catalog.listSeries(locale: 'en')).series, isNotEmpty);
    expect(server.requestsTo('GetTenantByDomain'), hasLength(2));
  });

  test('listSeries maps a Connect internal error to unexpected', () async {
    server.listStatus = HttpStatus.internalServerError;
    server.listResponse = const {'code': 'internal', 'message': 'boom'};

    expect(
      () => catalog.listSeries(locale: 'en'),
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
            return protoResponse(
              pb.GetTenantByDomainResponse(
                tenantId: ConnectFixtureServer.defaultTenantId,
              ),
            );
          }
          await Future<void>.delayed(const Duration(seconds: 1));
          return protoResponse(pb.ListPublishedSeriesResponse());
        }),
      ),
    );

    await expectLater(
      unresponsive.listSeries(locale: 'en'),
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

    expect(
      await catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en'),
      isNull,
    );
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
        locale: 'en',
      ),
      isNull,
    );
  });

  test('listSeries reads a series without a label as unlabelled', () async {
    final items = (await catalog.listSeries(locale: 'en')).series;
    expect(items.last.labelName, isEmpty);
  });

  test('listSeries rejects a series with a blank public id', () async {
    server.series = [pb.Series(publicId: '   ', title: 'Blank public id')];

    expect(
      () => catalog.listSeries(locale: 'en'),
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
    server.detailResponse = pb.GetSeriesDetailResponse(
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      episodes: [
        pb.Episode(
          publicId: 'EP10',
          title: 'Tenth',
          orderIndex: 10,
          price: 500,
        ),
        pb.Episode(publicId: 'EP01', title: 'First', orderIndex: 1, price: 0),
      ],
    );

    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(detail!.episodes.map((episode) => episode.id), ['EP01', 'EP10']);
    expect(detail.series.episodeCount, 2);
  });

  test('getSeries reads omitted numbers as zero', () async {
    // The wire format omits a zero, so an episode that is first and free
    // arrives without `orderIndex` and without `price`.
    server.detailResponse = pb.GetSeriesDetailResponse(
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      episodes: [pb.Episode(publicId: 'EP01', title: 'First')],
    );

    final detail = await catalog.getSeries(
      ConnectFixtureServer.seedSeriesId,
      locale: 'en',
    );

    expect(detail!.episodes.single.orderIndex, 0);
    expect(detail.episodes.single.price, 0);
  });

  test('getSeries rejects an episode without a public id', () async {
    server.detailResponse = pb.GetSeriesDetailResponse(
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      episodes: [pb.Episode(title: 'No public id')],
    );

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en'),
      throwsA(
        isA<CatalogFailure>().having(
          (error) => error.kind,
          'kind',
          CatalogFailureKind.unexpected,
        ),
      ),
    );
  });

  test('getSeries rejects a detail that does not decode', () async {
    server.detailResponse = undecodableBody;

    expect(
      () => catalog.getSeries(ConnectFixtureServer.seedSeriesId, locale: 'en'),
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
    server.episodeResponse = withUnnamedEnum(
      pb.GetEpisodeDetailResponse(
        episode: pb.Episode(publicId: 'EP', title: 'Newly gated'),
        series: pb.Series(
          publicId: ConnectFixtureServer.seedSeriesId,
          title: ConnectFixtureServer.seedSeriesTitle,
        ),
      ),
      _episodeAccessField,
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.access, EpisodeAccess.unknown);
    expect(detail.images, isEmpty);
  });

  test('getEpisode reads an omitted access as unknown', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'No access field'),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.access, EpisodeAccess.unknown);
  });

  test('getEpisode reads omitted page sizes as zero', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Sizeless pages'),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      images: [pb.EpisodeImage(id: 'a', imageUrl: '/images/episodes/a')],
    );

    final detail = await catalog.getEpisode(
      ConnectFixtureServer.seedSeriesId,
      ConnectFixtureServer.seedEpisodeId,
      locale: 'en',
    );

    expect(detail!.images.single.width, 0);
    expect(detail.images.single.height, 0);
    expect(detail.images.single.displayOrder, 0);
  });

  test('getEpisode rejects a page without an image url', () async {
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Unreachable page'),
      series: pb.Series(
        publicId: ConnectFixtureServer.seedSeriesId,
        title: ConnectFixtureServer.seedSeriesTitle,
      ),
      access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
      images: [pb.EpisodeImage(id: 'a')],
    );

    expect(
      () => catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
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
        episodeInternalId: ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        episodeId,
        4,
        episodeInternalId: ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.markEpisodeAsRead(
        episodeId,
        episodeInternalId: ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.listRecentSeries(limit: 6, locale: 'en');
      await signedIn.getSeriesProgress(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        locale: 'en',
      );
      await signedIn.listEpisodeReads(limit: 20, locale: 'en');
      await signedIn.getEpisodeReaction(
        ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.reactToEpisode(
        ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.getMySeriesRating(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
      );

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
          'GetMySeriesProgress',
          'ListMyEpisodeReads',
          'GetMyEpisodeRating',
          'RateEpisode',
          'GetMySeriesRating',
        },
      );
      for (final call in calls) {
        final surface = switch (call.path.split('/').last) {
          'GetMyReadingPosition' =>
            call.decode(pb.GetMyReadingPositionRequest()).surface,
          'SaveReadingPosition' =>
            call.decode(pb.SaveReadingPositionRequest()).surface,
          'MarkEpisodeAsRead' =>
            call.decode(pb.MarkEpisodeAsReadRequest()).surface,
          'ListMyRecentSeries' =>
            call.decode(pb.ListMyRecentSeriesRequest()).surface,
          'GetMySeriesProgress' =>
            call.decode(pb.GetMySeriesProgressRequest()).surface,
          'ListMyEpisodeReads' =>
            call.decode(pb.ListMyEpisodeReadsRequest()).surface,
          'GetMyEpisodeRating' =>
            call.decode(pb.GetMyEpisodeRatingRequest()).surface,
          'RateEpisode' => call.decode(pb.RateEpisodeRequest()).surface,
          'GetMySeriesRating' =>
            call.decode(pb.GetMySeriesRatingRequest()).surface,
          final procedure => fail('no request message for $procedure'),
        };
        expect(surface, pb.ClientSurface.CLIENT_SURFACE_APP, reason: call.path);
      }
    });

    test(
      'getEpisodeReaction reads whether the member is credited on it',
      () async {
        final internalId = ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        );
        expect(
          (await signedIn.getEpisodeReaction(internalId))!.readerCredited,
          isFalse,
        );

        server.episodeRatingResponse = pb.GetMyEpisodeRatingResponse(
          ratingCount: Int64(3),
          readerCredited: true,
        );
        final credited = await signedIn.getEpisodeReaction(internalId);

        expect(credited!.readerCredited, isTrue);
        expect(credited.score, 0);
        expect(credited.ratingCount, 3);
      },
    );

    test(
      'getEpisodeReaction reads whether the member holds a staff role',
      () async {
        final internalId = ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        );
        expect(
          (await signedIn.getEpisodeReaction(internalId))!.readerIsStaff,
          isFalse,
        );

        server.episodeRatingResponse = pb.GetMyEpisodeRatingResponse(
          ratingCount: Int64(3),
          readerIsStaff: true,
        );
        final staff = await signedIn.getEpisodeReaction(internalId);

        expect(staff!.readerIsStaff, isTrue);
        expect(staff.readerCredited, isFalse);
        expect(staff.ratingCount, 3);
      },
    );

    test('reactToEpisode carries the reason the press was refused', () async {
      server.rateEpisodeError = (
        status: HttpStatus.forbidden,
        body: {
          'code': 'permission_denied',
          'message': 'reader is credited on the episode',
          'details': [
            ConnectFixtureServer.errorInfoDetail(readerCreditedOnEpisodeReason),
          ],
        },
      );

      expect(
        () => signedIn.reactToEpisode(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedEpisodeId),
        ),
        throwsA(
          isA<CatalogFailure>()
              .having((error) => error.refused, 'refused', isTrue)
              .having((error) => error.reasons, 'reasons', [
                readerCreditedOnEpisodeReason,
              ]),
        ),
      );
    });

    test('getReadingPosition answers the page the member stopped on', () async {
      expect(
        await signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
          episodeInternalId: ConnectFixtureServer.internalIdOf(
            ConnectFixtureServer.seedEpisodeId,
          ),
        ),
        11,
      );
    });

    test('an episode the member never opened has no position', () async {
      expect(
        await signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.paidEpisodeId,
          episodeInternalId: ConnectFixtureServer.internalIdOf(
            ConnectFixtureServer.paidEpisodeId,
          ),
        ),
        isNull,
      );
    });

    test('saveReadingPosition records the page against the episode', () async {
      await signedIn.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        4,
        episodeInternalId: ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        ),
      );

      expect(server.readingPositions[ConnectFixtureServer.seedEpisodeId], 4);
      final recorded = server.requestsTo('SaveReadingPosition').single;
      expect(
        recorded.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
      expect(
        recorded.decode(pb.SaveReadingPositionRequest()).tenant.tenantId,
        ConnectFixtureServer.defaultTenantId,
      );
    });

    test('markEpisodeAsRead records the finish against the episode', () async {
      await signedIn.markEpisodeAsRead(
        ConnectFixtureServer.seedEpisodeId,
        episodeInternalId: ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        ),
      );

      expect(server.episodeReads.keys, [ConnectFixtureServer.seedEpisodeId]);
      final recorded = server.requestsTo('MarkEpisodeAsRead').single;
      expect(
        recorded.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
      expect(
        recorded.decode(pb.MarkEpisodeAsReadRequest()).tenant.tenantId,
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
          () => signedIn.markEpisodeAsRead(
            ConnectFixtureServer.seedEpisodeId,
            episodeInternalId: ConnectFixtureServer.internalIdOf(
              ConnectFixtureServer.seedEpisodeId,
            ),
          ),
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
      final items = (await signedIn.listRecentSeries(
        limit: 6,
        locale: 'en',
      )).series;

      expect(items, hasLength(1));
      expect(items.single.series.id, ConnectFixtureServer.seedSeriesId);
      expect(items.single.series.eyeCatchVariants, isNotEmpty);
      expect(items.single.episode.id, ConnectFixtureServer.seedEpisodeId);
      expect(
        server.requestsOf(pb.ListMyRecentSeriesRequest.new).single.limit,
        6,
      );
    });

    test('listRecentSeries asks for the page the token names', () async {
      final recent = server.recentSeries.single;
      server.recentSeries = [
        for (final id in ['series-a', 'series-b', 'series-c'])
          recent.deepCopy()..series.publicId = id,
      ];

      final first = await signedIn.listRecentSeries(limit: 2, locale: 'en');
      final second = await signedIn.listRecentSeries(
        limit: 2,
        token: first.nextToken,
        locale: 'en',
      );

      expect(first.series.map((item) => item.series.id), [
        'series-a',
        'series-b',
      ]);
      expect(first.nextToken, isNotEmpty);
      expect(second.series.single.series.id, 'series-c');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsOf(pb.ListMyRecentSeriesRequest.new);
      expect(requests.first.hasToken(), isFalse);
      expect(requests.last.token, first.nextToken);
    });

    test('a position or a finish that lands is announced', () async {
      final writes = <void>[];
      final subscription = signedIn.readingProgressWrites.listen(writes.add);
      addTearDown(subscription.cancel);
      const episodeId = ConnectFixtureServer.seedEpisodeId;

      await signedIn.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        episodeId,
        4,
        episodeInternalId: ConnectFixtureServer.internalIdOf(episodeId),
      );
      await signedIn.markEpisodeAsRead(
        episodeId,
        episodeInternalId: ConnectFixtureServer.internalIdOf(episodeId),
      );
      await pumpEventQueue();

      expect(writes, hasLength(2));
    });

    test(
      'a reaction that lands is announced, and a refused one is not',
      () async {
        final writes = <void>[];
        final subscription = signedIn.reactionWrites.listen(writes.add);
        addTearDown(subscription.cancel);
        final episodeId = ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        );

        await signedIn.reactToEpisode(episodeId);
        server.rateEpisodeError = (
          status: HttpStatus.notFound,
          body: {'code': 'not_found', 'message': 'episode not found'},
        );
        await expectLater(
          signedIn.reactToEpisode(episodeId),
          throwsA(isA<CatalogFailure>()),
        );
        await pumpEventQueue();

        expect(writes, hasLength(1));
      },
    );

    test('a finish the API refuses is not announced', () async {
      server.markReadErrorCode = 'permission_denied';
      final writes = <void>[];
      final subscription = signedIn.readingProgressWrites.listen(writes.add);
      addTearDown(subscription.cancel);

      await expectLater(
        signedIn.markEpisodeAsRead(
          ConnectFixtureServer.seedEpisodeId,
          episodeInternalId: ConnectFixtureServer.internalIdOf(
            ConnectFixtureServer.seedEpisodeId,
          ),
        ),
        throwsA(isA<CatalogFailure>()),
      );
      await pumpEventQueue();

      expect(writes, isEmpty);
    });

    test(
      'getSeriesProgress maps the episode to resume and the finished ones',
      () async {
        server
          ..seriesProgress = {
            ConnectFixtureServer.seedSeriesId: pb.SeriesProgress(
              episode: pb.Episode(
                publicId: 'SeedEPSDAAA3',
                title: 'Seed Episode 001-03',
                orderIndex: 3,
              ),
              position: pb.ReadingPosition(
                episodePublicId: 'SeedEPSDAAA3',
                pageIndex: 2,
              ),
            ),
          }
          ..episodeReads.addAll({
            ConnectFixtureServer.seedEpisodeId: '2026-09-01T00:00:00Z',
            ConnectFixtureServer.paidEpisodeId: '2026-09-02T00:00:00Z',
          });

        final progress = await signedIn.getSeriesProgress(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
          locale: 'en',
        );

        expect(progress.episode?.id, 'SeedEPSDAAA3');
        expect(progress.episode?.orderIndex, 3);
        // The wire format omits a false.
        expect(progress.isFinished, isFalse);
        expect(progress.finishedEpisodeIds, {
          ConnectFixtureServer.seedEpisodeId,
          ConnectFixtureServer.paidEpisodeId,
        });
        final request = server.requestsTo('GetMySeriesProgress').single;
        expect(
          request.decode(pb.GetMySeriesProgressRequest()).seriesId,
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        );
        expect(
          request.headers['authorization'],
          'Bearer ${ConnectFixtureServer.memberAccessToken}',
        );
      },
    );

    test('getSeriesProgress reads a finished episode as finished', () async {
      server.seriesProgress = {
        ConnectFixtureServer.seedSeriesId: pb.SeriesProgress(
          episode: pb.Episode(
            publicId: ConnectFixtureServer.seedEpisodeId,
            orderIndex: 1,
          ),
          isFinished: true,
        ),
      };

      final progress = await signedIn.getSeriesProgress(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        locale: 'en',
      );

      expect(progress.episode?.id, ConnectFixtureServer.seedEpisodeId);
      expect(progress.isFinished, isTrue);
    });

    test(
      'a member who opened nothing of a series stands nowhere in it',
      () async {
        final progress = await signedIn.getSeriesProgress(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
          locale: 'en',
        );

        expect(progress.episode, isNull);
        expect(progress.isFinished, isFalse);
        expect(progress.finishedEpisodeIds, isEmpty);
      },
    );

    test('getMySeriesRating reads the mean of the member\'s scores', () async {
      server.seriesRatings = {
        ConnectFixtureServer.seedSeriesId: pb.GetMySeriesRatingResponse(
          ratingAverage: 4.3,
          ratedEpisodeCount: 3,
        ),
      };

      final rating = await signedIn.getMySeriesRating(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
      );

      expect(rating, 4.3);
      final request = server.requestsTo('GetMySeriesRating').single;
      expect(
        request.decode(pb.GetMySeriesRatingRequest()).seriesId,
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
      );
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test(
      'a member who reacted to no episode has no rating of the series',
      () async {
        // The wire format omits both zeros, which is the whole answer for them.
        final rating = await signedIn.getMySeriesRating(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        );

        expect(rating, isNull);
      },
    );

    test('a series rating outside the scale is refused', () async {
      server.seriesRatings = {
        ConnectFixtureServer.seedSeriesId: pb.GetMySeriesRatingResponse(
          ratingAverage: 7,
          ratedEpisodeCount: 1,
        ),
      };

      await expectLater(
        signedIn.getMySeriesRating(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
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

    test('listEpisodeReads maps the episode, its series, and when', () async {
      final reads = (await signedIn.listEpisodeReads(
        limit: 20,
        locale: 'en',
      )).reads;

      expect(reads, hasLength(1));
      expect(reads.single.series.id, ConnectFixtureServer.seedSeriesId);
      expect(reads.single.series.title, ConnectFixtureServer.seedSeriesTitle);
      expect(reads.single.episode.id, ConnectFixtureServer.seedEpisodeId);
      expect(reads.single.episode.orderIndex, 1);
      expect(reads.single.readAt, DateTime.utc(2026, 9, 1).toLocal());
      final request = server.requestsTo('ListMyEpisodeReads').single;
      expect(request.decode(pb.ListMyEpisodeReadsRequest()).limit, 20);
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test('listEpisodeReads asks for the page the token names', () async {
      final read = server.episodeReadHistory.single;
      server.episodeReadHistory = [
        for (final id in ['episode-a', 'episode-b', 'episode-c'])
          read.deepCopy()..episode.publicId = id,
      ];

      final first = await signedIn.listEpisodeReads(limit: 2, locale: 'en');
      final second = await signedIn.listEpisodeReads(
        limit: 2,
        token: first.nextToken,
        locale: 'en',
      );

      expect(first.reads.map((read) => read.episode.id), [
        'episode-a',
        'episode-b',
      ]);
      expect(second.reads.single.episode.id, 'episode-c');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsOf(pb.ListMyEpisodeReadsRequest.new);
      expect(requests.first.hasToken(), isFalse);
      expect(requests.last.token, first.nextToken);
    });

    test('a member who finished nothing has an empty history', () async {
      server.episodeReadHistory = const [];

      final page = await signedIn.listEpisodeReads(limit: 20, locale: 'en');

      expect(page.reads, isEmpty);
      expect(page.nextToken, isEmpty);
    });

    test('a guest asks the API for none of it', () async {
      final writes = <void>[];
      final subscription = catalog.readingProgressWrites.listen(writes.add);
      addTearDown(subscription.cancel);
      expect(
        await catalog.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
          episodeInternalId: ConnectFixtureServer.internalIdOf(
            ConnectFixtureServer.seedEpisodeId,
          ),
        ),
        isNull,
      );
      await catalog.saveReadingPosition(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        4,
        episodeInternalId: ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        ),
      );
      await catalog.markEpisodeAsRead(
        ConnectFixtureServer.seedEpisodeId,
        episodeInternalId: ConnectFixtureServer.internalIdOf(
          ConnectFixtureServer.seedEpisodeId,
        ),
      );
      expect(
        (await catalog.listRecentSeries(limit: 6, locale: 'en')).series,
        isEmpty,
      );
      final progress = await catalog.getSeriesProgress(
        ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        locale: 'en',
      );
      expect(progress.episode, isNull);
      expect(progress.finishedEpisodeIds, isEmpty);
      expect(
        (await catalog.listEpisodeReads(limit: 20, locale: 'en')).reads,
        isEmpty,
      );
      expect(
        await catalog.getMySeriesRating(
          ConnectFixtureServer.internalIdOf(ConnectFixtureServer.seedSeriesId),
        ),
        isNull,
      );

      // Nothing was asked, so nothing was refused: the API answers a request
      // without a session `unauthenticated`, and there is no answer in that
      // worth a round trip.
      expect(server.requestsTo('GetMyReadingPosition'), isEmpty);
      expect(server.requestsTo('SaveReadingPosition'), isEmpty);
      expect(server.requestsTo('MarkEpisodeAsRead'), isEmpty);
      expect(server.requestsTo('ListMyRecentSeries'), isEmpty);
      expect(server.requestsTo('GetMySeriesProgress'), isEmpty);
      expect(server.requestsTo('GetMySeriesRating'), isEmpty);
      // Nothing was recorded, so nothing is announced either.
      await pumpEventQueue();
      expect(writes, isEmpty);
      expect(server.requestsTo('ListMyEpisodeReads'), isEmpty);
      expect(server.readingPositions[ConnectFixtureServer.seedEpisodeId], 11);
    });

    test('a rejected session is reported rather than resumed from', () async {
      server.activeAccessToken = 'another-token';

      expect(
        () => signedIn.getReadingPosition(
          ConnectFixtureServer.seedSeriesId,
          ConnectFixtureServer.seedEpisodeId,
          episodeInternalId: ConnectFixtureServer.internalIdOf(
            ConnectFixtureServer.seedEpisodeId,
          ),
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
        () => signedIn.listEpisodeReads(limit: 20, locale: 'en'),
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
    pb.FollowUpdate arrival(String seriesId, String episodeId) {
      return pb.FollowUpdate(
        series: pb.Series(publicId: seriesId, title: 'Series $seriesId'),
        episode: pb.Episode(
          publicId: episodeId,
          title: 'Episode $episodeId',
          orderIndex: 3,
          price: 0,
          publishedAt: '2026-09-01T00:00:00Z',
        ),
      );
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
      final updates = (await signedIn.listFollowUpdates(
        limit: 20,
        locale: 'en',
      )).updates;

      expect(updates.first.series.id, 'series-a');
      expect(updates.first.series.title, 'Series series-a');
      expect(updates.first.episode.id, 'episode-a');
      expect(updates.first.episode.orderIndex, 3);
      expect(updates.first.publishedAt, DateTime.utc(2026, 9, 1).toLocal());
      final request = server.requestsTo('ListMyFollowUpdates').single;
      final body = request.decode(pb.ListMyFollowUpdatesRequest());
      expect(body.limit, 20);
      expect(body.surface, pb.ClientSurface.CLIENT_SURFACE_APP);
      expect(
        request.headers['authorization'],
        'Bearer ${ConnectFixtureServer.memberAccessToken}',
      );
    });

    test('asks for the page the token names', () async {
      final first = await signedIn.listFollowUpdates(limit: 1, locale: 'en');
      final second = await signedIn.listFollowUpdates(
        limit: 1,
        token: first.nextToken,
        locale: 'en',
      );

      expect(first.updates.single.episode.id, 'episode-a');
      expect(second.updates.single.episode.id, 'episode-b');
      expect(second.nextToken, isEmpty);
      final requests = server.requestsOf(pb.ListMyFollowUpdatesRequest.new);
      expect(requests.first.hasToken(), isFalse);
      expect(requests.last.token, first.nextToken);
    });

    test('a member with nothing new has an empty list', () async {
      server.followUpdates = const [];

      final page = await signedIn.listFollowUpdates(limit: 20, locale: 'en');

      expect(page.updates, isEmpty);
      expect(page.nextToken, isEmpty);
    });

    test('an episode without a readable publish time still lists', () async {
      server.followUpdates = [
        server.followUpdates.first.deepCopy()
          ..episode.publishedAt = 'not a time',
      ];

      final updates = (await signedIn.listFollowUpdates(
        limit: 20,
        locale: 'en',
      )).updates;

      expect(updates.single.publishedAt, isNull);
    });

    test('a guest asks the API for none of it', () async {
      expect(
        (await catalog.listFollowUpdates(limit: 20, locale: 'en')).updates,
        isEmpty,
      );
      expect(server.requestsTo('ListMyFollowUpdates'), isEmpty);
    });

    test('a rejected session is reported as one', () async {
      server.activeAccessToken = 'another-token';

      expect(
        () => signedIn.listFollowUpdates(limit: 20, locale: 'en'),
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
    server.episodeResponse = pb.GetEpisodeDetailResponse(
      episode: pb.Episode(publicId: 'EP', title: 'Orphan'),
      access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
    );

    expect(
      () => catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
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

  group('the reader\'s locale', () {
    late HttpCatalogRepository member;

    setUp(() {
      member = HttpCatalogRepository(
        config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
        client: ConnectClient(
          baseUrl: server.baseUrl,
          accessToken: () => ConnectFixtureServer.memberAccessToken,
        ),
      );
    });

    test('every read that answers a title asks in the locale given', () async {
      const locale = 'zh-Hans';
      final seriesId = ConnectFixtureServer.internalIdOf(
        ConnectFixtureServer.seedSeriesId,
      );
      await member.listSeries(locale: locale);
      await member.listNewestSeries(limit: 3, locale: locale);
      await member.searchSeries(query: 'Seed', locale: locale);
      await member.listRankedSeries(
        limit: 3,
        period: RankingPeriod.weekly,
        ageRating: SeriesAgeRating.all,
        locale: locale,
      );
      await member.listRelatedSeries(seriesId, limit: 3, locale: locale);
      await member.listRecommendedSeries(limit: 3, locale: locale);
      await member.listMyRecommendedSeries(limit: 3, locale: locale);
      await member.getSeries(ConnectFixtureServer.seedSeriesId, locale: locale);
      await member.getCreatorDetail('SeedAUTHAAA1', locale: locale);
      await member.getLabelDetail('SeedLABLAAA1', locale: locale);
      await member.listGenreSeries('SeedGENRAAA1', locale: locale);
      await member.listTagSeries('time-travel', locale: locale);
      await member.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: locale,
      );
      await member.getSeriesProgress(seriesId, locale: locale);
      await member.listRecentSeries(limit: 3, locale: locale);
      await member.listEpisodeReads(limit: 3, locale: locale);
      await member.listFollowUpdates(limit: 3, locale: locale);
      await member.listGenres(locale: locale);

      String localeOf(String procedure) {
        final requests = server.requestsTo(procedure);
        expect(requests, isNotEmpty, reason: procedure);
        return switch (procedure) {
          'SearchPublishedSeries' =>
            requests.single.decode(pb.SearchPublishedSeriesRequest()).locale,
          'ListRankedSeries' =>
            requests.single.decode(pb.ListRankedSeriesRequest()).locale,
          'ListRelatedSeries' =>
            requests.single.decode(pb.ListRelatedSeriesRequest()).locale,
          'ListRecommendedSeries' =>
            requests.single.decode(pb.ListRecommendedSeriesRequest()).locale,
          'ListMyRecommendedSeries' =>
            requests.single.decode(pb.ListMyRecommendedSeriesRequest()).locale,
          'GetSeriesDetail' =>
            requests.single.decode(pb.GetSeriesDetailRequest()).locale,
          'GetPublishedCreatorDetail' =>
            requests.single
                .decode(pb.GetPublishedCreatorDetailRequest())
                .locale,
          'GetPublishedLabelDetail' =>
            requests.single.decode(pb.GetPublishedLabelDetailRequest()).locale,
          'GetEpisodeDetail' =>
            requests.single.decode(pb.GetEpisodeDetailRequest()).locale,
          'GetMySeriesProgress' =>
            requests.single.decode(pb.GetMySeriesProgressRequest()).locale,
          'ListMyRecentSeries' =>
            requests.single.decode(pb.ListMyRecentSeriesRequest()).locale,
          'ListMyEpisodeReads' =>
            requests.single.decode(pb.ListMyEpisodeReadsRequest()).locale,
          'ListMyFollowUpdates' =>
            requests.single.decode(pb.ListMyFollowUpdatesRequest()).locale,
          'ListPublishedGenres' =>
            requests.single.decode(pb.ListPublishedGenresRequest()).locale,
          _ => fail('no request message for $procedure'),
        };
      }

      for (final read in server.requestsTo('ListPublishedSeries')) {
        expect(read.decode(pb.ListPublishedSeriesRequest()).locale, locale);
      }
      for (final procedure in [
        'SearchPublishedSeries',
        'ListRankedSeries',
        'ListRelatedSeries',
        'ListRecommendedSeries',
        'ListMyRecommendedSeries',
        'GetSeriesDetail',
        'GetPublishedCreatorDetail',
        'GetPublishedLabelDetail',
        'GetEpisodeDetail',
        'GetMySeriesProgress',
        'ListMyRecentSeries',
        'ListMyEpisodeReads',
        'ListMyFollowUpdates',
        'ListPublishedGenres',
      ]) {
        expect(localeOf(procedure), locale, reason: procedure);
      }
    });

    test('a series names the locale its title was served in', () async {
      server.series.first.locale = 'ja';
      server.details[ConnectFixtureServer.seedSeriesId]!.series.locale = 'ja';

      final listed = (await catalog.listSeries(locale: 'en')).series.first;
      final detail = await catalog.getSeries(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      );

      expect(listed.locale, 'ja');
      expect(detail!.series.locale, 'ja');
    });

    test('each genre names the locale its own name was served in', () async {
      server.genres = ConnectFixtureServer.populatedGenres();
      server.genres.first.locale = 'en';
      server.genres.last.locale = 'ja';
      server.series.first.genres.single.locale = 'ja';
      final seed = server.details[ConnectFixtureServer.seedSeriesId]!;
      seed.series.genres.single.locale = 'ja';

      final genres = await catalog.listGenres(locale: 'en');
      final listed = (await catalog.listSeries(locale: 'en')).series.first;
      final detail = await catalog.getSeries(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      );

      expect([for (final genre in genres) genre.locale], ['en', 'ja']);
      expect(listed.genres.single.locale, 'ja');
      expect(detail!.series.genres.single.locale, 'ja');
    });

    test('each episode names the locale its own title was served in', () async {
      server.details[ConnectFixtureServer.seedSeriesId]!.episodes.first.locale =
          'ja';
      server.episodes[ConnectFixtureServer.seedEpisodeId]!
        ..episode.locale = 'en'
        ..series.locale = 'ja'
        ..nextEpisode = pb.EpisodeNeighbor(
          publicId: 'EP02',
          title: 'Second',
          orderIndex: 2,
          isFree: true,
          locale: 'ko',
        );

      final detail = await catalog.getSeries(
        ConnectFixtureServer.seedSeriesId,
        locale: 'en',
      );
      final episode = await catalog.getEpisode(
        ConnectFixtureServer.seedSeriesId,
        ConnectFixtureServer.seedEpisodeId,
        locale: 'en',
      );

      final first = server
          .details[ConnectFixtureServer.seedSeriesId]!
          .episodes
          .first
          .publicId;
      expect(
        detail!.episodes.firstWhere((item) => item.id == first).locale,
        'ja',
      );
      expect(episode!.episode.locale, 'en');
      expect(episode.seriesLocale, 'ja');
      expect(episode.nextEpisode!.locale, 'ko');
    });
  });
}
