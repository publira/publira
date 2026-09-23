import 'dart:async';
import 'dart:math';

import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_item.dart';

/// In-memory [CatalogRepository] for widget tests.
class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.series = const [],
    this.seriesPageSize = 20,
    this.newestSeries = const [],
    this.rankedSeries = const [],
    this.details = const {},
    this.episodes = const {},
    this.recentSeries = const [],
    this.readingPositions = const {},
    this.searchResults = const [],
    this.creatorSearchResults = const [],
    this.labelSearchResults = const [],
    this.searchPageSize = 20,
    this.publishedCreators = const {},
    this.publishedLabels = const {},
    this.detailSeries = const {},
    this.detailSeriesPageSize = 20,
    this.listError,
    this.listMoreError,
    this.searchError,
    this.searchMoreError,
    this.creatorSearchError,
    this.labelSearchError,
    this.creatorDetailError,
    this.labelDetailError,
    this.detailSeriesMoreError,
    this.newestSeriesError,
    this.rankedSeriesError,
    this.creators = const [],
    this.detailError,
    this.creatorError,
    this.episodeError,
    this.readingPositionError,
    this.recentSeriesError,
    this.reactionError,
    this.reactions = const {},
  });

  /// The whole catalog [listSeries] pages over.
  List<SeriesItem> series;

  /// How many of [series] one page of [listSeries] holds.
  int seriesPageSize;

  /// What [searchSeries] pages over, whatever keyword it is asked for. The
  /// screen is about which rows arrive for a keyword, not about matching.
  List<SeriesItem> searchResults;

  /// What [searchCreators] pages over, whatever keyword it is asked for.
  List<PublishedCreator> creatorSearchResults;

  /// What [searchLabels] pages over, whatever keyword it is asked for.
  List<PublishedLabel> labelSearchResults;

  /// How many results one page of every search holds.
  int searchPageSize;

  /// The authors [getCreatorDetail] answers for, keyed by public id.
  Map<String, PublishedCreator> publishedCreators;

  /// The labels [getLabelDetail] answers for, keyed by public id.
  Map<String, PublishedLabel> publishedLabels;

  /// The series an author's or a label's page lists, keyed by the public id
  /// of the author or label. One absent is a page with no series.
  Map<String, List<SeriesItem>> detailSeries;

  /// How many of [detailSeries] one page of an author or a label holds.
  int detailSeriesPageSize;

  /// What the new-arrivals shelf is answered with.
  List<SeriesItem> newestSeries;

  /// What the ranking shelf is answered with.
  List<RankedSeriesItem> rankedSeries;

  Map<String, SeriesDetail> details;

  /// The creators [getCreator] answers from, looked up by public id.
  List<SeriesCreator> creators;

  /// Keyed by [episodeKey] so a fake can hold the same episode id under two
  /// series and still answer each pair separately.
  Map<String, EpisodeDetail> episodes;

  /// What the continue-reading row is answered with.
  List<RecentSeriesItem> recentSeries;

  /// Saved positions keyed by [episodeKey], which [saveReadingPosition] writes
  /// to so a test can assert what the viewer recorded.
  Map<String, int> readingPositions;

  CatalogFailure? listError;

  /// What a read of a page under the first one fails with, so a test can fail
  /// one page of the catalog without failing the screen.
  CatalogFailure? listMoreError;
  CatalogFailure? searchError;

  /// What a read of a page under the first one fails with, so a test can fail
  /// one page of the results without failing the screen.
  CatalogFailure? searchMoreError;
  CatalogFailure? creatorSearchError;
  CatalogFailure? labelSearchError;
  CatalogFailure? creatorDetailError;
  CatalogFailure? labelDetailError;

  /// What a read of a page of an author's or a label's series under the first
  /// one fails with.
  CatalogFailure? detailSeriesMoreError;
  CatalogFailure? newestSeriesError;
  CatalogFailure? rankedSeriesError;
  CatalogFailure? detailError;
  CatalogFailure? creatorError;
  CatalogFailure? episodeError;
  CatalogFailure? readingPositionError;
  CatalogFailure? recentSeriesError;
  CatalogFailure? reactionError;

  /// Held open by a test that switches readers while a reaction is loading.
  Completer<EpisodeReaction?>? reactionGate;

  Map<String, EpisodeReaction> reactions;

  /// Tokens [listSeries] was called with, in order. The first page is the
  /// empty one.
  final List<String> seriesTokens = <String>[];

  /// Keywords [searchSeries] was called with, in order, each with the token
  /// it was asked for. The first page of a keyword is the empty token.
  final List<({String query, String token})> searchRequests =
      <({String query, String token})>[];

  /// Keywords [searchCreators] was called with, in order, with their tokens.
  final List<({String query, String token})> creatorSearchRequests =
      <({String query, String token})>[];

  /// Keywords [searchLabels] was called with, in order, with their tokens.
  final List<({String query, String token})> labelSearchRequests =
      <({String query, String token})>[];

  /// Public ids [getCreatorDetail] and [getLabelDetail] were called with, in
  /// order, with their tokens.
  final List<({String id, String token})> detailRequests =
      <({String id, String token})>[];

  /// Limits [listRecentSeries] was called with, in order.
  final List<int> recentSeriesLimits = <int>[];

  /// Tokens [listRecentSeries] was called with, in order.
  final List<String> recentSeriesTokens = <String>[];

  /// Limits [listNewestSeries] was called with, in order.
  final List<int> newestSeriesLimits = <int>[];

  /// Periods [listRankedSeries] was called with, in order.
  final List<RankingPeriod> rankedSeriesPeriods = <RankingPeriod>[];

  /// Pages over [series], [seriesPageSize] at a time.
  ///
  /// The token stands in for the API's opaque cursor and is the index of the
  /// page's first row, written out. A test passes back whatever it was given,
  /// the way the screen does.
  @override
  Future<SeriesPage> listSeries({String token = ''}) async {
    seriesTokens.add(token);
    final error = token.isEmpty ? listError : listMoreError ?? listError;
    if (error != null) {
      throw error;
    }
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = min(start + seriesPageSize, series.length);
    return SeriesPage(
      series: List<SeriesItem>.from(series.sublist(start, end)),
      nextToken: end < series.length ? '$end' : '',
    );
  }

  /// Pages over [searchResults] the way [listSeries] pages over the catalog.
  @override
  Future<SeriesPage> searchSeries({
    required String query,
    String token = '',
  }) async {
    searchRequests.add((query: query, token: token));
    final error = token.isEmpty ? searchError : searchMoreError ?? searchError;
    if (error != null) {
      throw error;
    }
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = min(start + searchPageSize, searchResults.length);
    return SeriesPage(
      series: List<SeriesItem>.from(searchResults.sublist(start, end)),
      nextToken: end < searchResults.length ? '$end' : '',
    );
  }

  @override
  Future<CreatorPage> searchCreators({
    required String query,
    String token = '',
  }) async {
    creatorSearchRequests.add((query: query, token: token));
    final error = creatorSearchError;
    if (error != null) {
      throw error;
    }
    final (page, nextToken) = _page(
      creatorSearchResults,
      token,
      searchPageSize,
    );
    return CreatorPage(creators: page, nextToken: nextToken);
  }

  @override
  Future<LabelPage> searchLabels({
    required String query,
    String token = '',
  }) async {
    labelSearchRequests.add((query: query, token: token));
    final error = labelSearchError;
    if (error != null) {
      throw error;
    }
    final (page, nextToken) = _page(labelSearchResults, token, searchPageSize);
    return LabelPage(labels: page, nextToken: nextToken);
  }

  @override
  Future<CreatorDetail?> getCreatorDetail(
    String publicId, {
    String token = '',
  }) async {
    detailRequests.add((id: publicId, token: token));
    final creator = publishedCreators[publicId];
    final series = await _detailSeries(publicId, token, creatorDetailError);
    return creator == null
        ? null
        : CreatorDetail(creator: creator, series: series);
  }

  @override
  Future<LabelDetail?> getLabelDetail(
    String publicId, {
    String token = '',
  }) async {
    detailRequests.add((id: publicId, token: token));
    final label = publishedLabels[publicId];
    final series = await _detailSeries(publicId, token, labelDetailError);
    return label == null ? null : LabelDetail(label: label, series: series);
  }

  Future<SeriesPage> _detailSeries(
    String publicId,
    String token,
    CatalogFailure? error,
  ) async {
    final failure = token.isEmpty ? error : detailSeriesMoreError ?? error;
    if (failure != null) {
      throw failure;
    }
    final (page, nextToken) = _page(
      detailSeries[publicId] ?? const <SeriesItem>[],
      token,
      detailSeriesPageSize,
    );
    return SeriesPage(series: page, nextToken: nextToken);
  }

  /// One page of [items], the token being the index of its first row written
  /// out, the way [listSeries] pages.
  (List<T>, String) _page<T>(List<T> items, String token, int size) {
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = min(start + size, items.length);
    return (
      List<T>.from(items.sublist(start, end)),
      end < items.length ? '$end' : '',
    );
  }

  @override
  Future<List<SeriesItem>> listNewestSeries({required int limit}) async {
    newestSeriesLimits.add(limit);
    final error = newestSeriesError;
    if (error != null) {
      throw error;
    }
    // The API answers a page of at most [limit], so a fixture longer than the
    // shelf asked for must not reach it here either.
    return List<SeriesItem>.from(newestSeries.take(limit));
  }

  @override
  Future<List<RankedSeriesItem>> listRankedSeries({
    required int limit,
    required RankingPeriod period,
  }) async {
    rankedSeriesPeriods.add(period);
    final error = rankedSeriesError;
    if (error != null) {
      throw error;
    }
    return List<RankedSeriesItem>.from(rankedSeries.take(limit));
  }

  @override
  Future<SeriesDetail?> getSeries(String publicId) async {
    final error = detailError;
    if (error != null) {
      throw error;
    }
    return details[publicId];
  }

  @override
  Future<String?> getSeriesTitle(String publicId) async {
    final error = detailError;
    if (error != null) {
      throw error;
    }
    return details[publicId]?.series.title;
  }

  @override
  Future<SeriesCreator?> getCreator(String publicId) async {
    final error = creatorError;
    if (error != null) {
      throw error;
    }
    for (final creator in creators) {
      if (creator.id == publicId) {
        return creator;
      }
    }
    return null;
  }

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final error = episodeError;
    if (error != null) {
      throw error;
    }
    return episodes[episodeKey(seriesPublicId, episodePublicId)];
  }

  @override
  Future<int?> getReadingPosition(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    final error = readingPositionError;
    if (error != null) {
      throw error;
    }
    return readingPositions[episodeKey(seriesPublicId, episodePublicId)];
  }

  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  ) async {
    final error = readingPositionError;
    if (error != null) {
      throw error;
    }
    readingPositions = {
      ...readingPositions,
      episodeKey(seriesPublicId, episodePublicId): pageIndex,
    };
  }

  @override
  Future<EpisodeReaction?> getEpisodeReaction(String episodePublicId) async {
    final gate = reactionGate;
    if (gate != null) {
      return gate.future;
    }
    final error = reactionError;
    if (error != null) {
      throw error;
    }
    return reactions[episodePublicId];
  }

  @override
  Future<EpisodeReaction> reactToEpisode(String episodePublicId) async {
    final error = reactionError;
    if (error != null) {
      throw error;
    }
    final current =
        reactions[episodePublicId] ??
        const EpisodeReaction(
          score: 0,
          ratingCount: 0,
          allowsMultiplePresses: false,
        );
    final score = current.allowsMultiplePresses
        ? (current.score < 5 ? current.score + 1 : 5)
        : 5;
    final next = EpisodeReaction(
      score: score,
      ratingCount: current.ratingCount + (current.score == 0 ? 1 : 0),
      allowsMultiplePresses: current.allowsMultiplePresses,
    );
    reactions = {...reactions, episodePublicId: next};
    return next;
  }

  @override
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    String token = '',
  }) async {
    recentSeriesLimits.add(limit);
    recentSeriesTokens.add(token);
    final error = recentSeriesError;
    if (error != null) {
      throw error;
    }
    // The API answers a page of at most [limit], so a fixture longer than the
    // screen asked for must not reach it here either. The token stands in for
    // the cursor as the index of the page's first row.
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = start + limit;
    return RecentSeriesPage(
      series: List<RecentSeriesItem>.from(recentSeries.skip(start).take(limit)),
      nextToken: end < recentSeries.length ? '$end' : '',
    );
  }
}

String episodeKey(String seriesPublicId, String episodePublicId) =>
    '$seriesPublicId/$episodePublicId';

/// Headers the repository resolves for a public image request.
const fixtureImageHeaders = {'x-forwarded-host': 'localhost'};

/// Cover renditions of [fixtureSeries]' first series, in the widths the server
/// stores. The second series carries none, which is what shows the
/// placeholder.
final fixtureEyeCatchVariants = <EyeCatchVariant>[
  for (final width in [400, 800, 1200])
    EyeCatchVariant(
      variantType: 'portrait',
      url: Uri.parse(
        'http://images.test/images/series/SeedSIMGAAA1/portrait/$width',
      ),
      width: width,
      height: width * 4 ~/ 3,
    ),
  for (final width in [800, 1600])
    EyeCatchVariant(
      variantType: 'landscape',
      url: Uri.parse(
        'http://images.test/images/series/SeedSIMGAAA1/landscape/$width',
      ),
      width: width,
      height: width * 9 ~/ 16,
    ),
];

/// The people credited on [fixtureSeries]' first series, in role priority
/// order. The two neighbouring artists are what a screen groups under one
/// role. The second series is credited to nobody, which is what leaves its
/// credit line off the screen.
const fixtureCreators = <SeriesCreator>[
  SeriesCreator(id: 'SeedAUTHAAA1', name: 'Seed Author 001', roleName: 'Story'),
  SeriesCreator(id: 'SeedAUTHAAA2', name: 'Seed Author 002', roleName: 'Art'),
  SeriesCreator(id: 'SeedAUTHAAA3', name: 'Seed Author 003', roleName: 'Art'),
];

/// The first author credited on [fixtureSeries]' first series, as the
/// author's own page describes them.
const fixturePublishedCreator = PublishedCreator(
  id: 'SeedAUTHAAA1',
  name: 'Seed Author 001',
  profileText: 'Profile text for Seed Author 001',
  seriesCount: 1,
);

/// The label of [fixtureSeries]' first series, as the label's own page
/// describes it.
const fixturePublishedLabel = PublishedLabel(
  id: 'SeedLABLAAA1',
  name: 'Seed Label 01',
  seriesCount: 1,
);

/// The first genre of the development seed, which [fixtureSeries]' first
/// series carries so a catalog tile has a genre to show.
const fixtureGenres = <SeriesGenre>[
  SeriesGenre(id: 'SeedGENRAAA1', name: 'Fantasy'),
];

final fixtureSeries = <SeriesItem>[
  SeriesItem(
    id: 'SeedSERSAAA1',
    title: 'Seed Series 001',
    description: 'A published series of Seed Tenant.',
    episodeCount: 10,
    labelId: 'SeedLABLAAA1',
    labelName: 'Seed Label 01',
    creators: fixtureCreators,
    eyeCatchVariants: fixtureEyeCatchVariants,
    imageRequestHeaders: fixtureImageHeaders,
    status: SeriesStatus.ongoing,
    scheduleWeekdays: const [1, 4],
    genres: fixtureGenres,
  ),
  const SeriesItem(
    id: 'series-kitchen',
    title: 'The Little Kitchen',
    description: 'Everyday cooking, one plate at a time.',
    episodeCount: 8,
  ),
];

/// A catalog of [count] series, for a tenant holding more than one page of
/// them. The titles are numbered so the row a test scrolls to can be named,
/// and carry nothing else: what paging is about is which rows arrive.
List<SeriesItem> fixtureCatalog(int count) => [
  for (var n = 1; n <= count; n++)
    SeriesItem(
      id: 'catalog-series-$n',
      title: 'Catalog Series ${n.toString().padLeft(3, '0')}',
      description: 'Series $n of the paged catalog.',
    ),
];

/// A restricted series used to exercise the confirmation before the body
/// opens. It is not part of [fixtureSeries], so catalog tests that tap the
/// first tile do not hit the gate.
const fixtureRatedSeries = SeriesItem(
  id: 'series-rated',
  title: 'After Dark',
  description: 'A series rated R15.',
  episodeCount: 3,
  status: SeriesStatus.ongoing,
  ageRating: SeriesAgeRating.r15,
  genres: [SeriesGenre(id: 'SeedGENRAAA2', name: 'Romance')],
);

/// An R18 series, used to check that an R15 confirmation does not open it.
const fixtureR18Series = SeriesItem(
  id: 'series-r18',
  title: 'Midnight',
  description: 'A series rated R18.',
  episodeCount: 2,
  ageRating: SeriesAgeRating.r18,
);

/// A series whose rating this build does not know, used to check the gate
/// fails closed instead of presenting the R15 copy.
const fixtureUnknownRatedSeries = SeriesItem(
  id: 'series-unknown-rating',
  title: 'Uncharted',
  description: 'A series with an unrecognized rating.',
  episodeCount: 1,
  ageRating: SeriesAgeRating.unknown,
);

/// [paidSurface] is where the paid episode, the last one, may be bought.
SeriesDetail fixtureDetail(
  SeriesItem item, {
  EpisodePurchaseSurface paidSurface = EpisodePurchaseSurface.all,
}) {
  return SeriesDetail(
    series: item,
    episodes: [
      for (var i = 1; i <= item.episodeCount; i++)
        EpisodeItem(
          id: '${item.id}-ep-$i',
          title: '${item.title} #$i',
          orderIndex: i,
          price: i == item.episodeCount ? 500 : 0,
          purchaseSurface: i == item.episodeCount
              ? paidSurface
              : EpisodePurchaseSurface.all,
        ),
    ],
  );
}

Map<String, SeriesDetail> fixtureDetails({
  EpisodePurchaseSurface paidSurface = EpisodePurchaseSurface.all,
}) {
  return {
    for (final item in fixtureSeries)
      item.id: fixtureDetail(item, paidSurface: paidSurface),
  };
}

/// A continue-reading row over the fixture series, each offering the first
/// episode of its own series.
List<RecentSeriesItem> fixtureRecentSeries() {
  return [
    for (final item in fixtureSeries)
      RecentSeriesItem(
        series: item,
        episode: fixtureDetail(item).episodes.first,
      ),
  ];
}

/// A week's chart over the fixture series. The positions run 1 and 3 because
/// they are a snapshot's own: a series ranked second and unpublished since
/// leaves the gap behind.
List<RankedSeriesItem> fixtureRankedSeries() {
  return [
    RankedSeriesItem(rank: 1, series: fixtureSeries.first),
    RankedSeriesItem(rank: 3, series: fixtureSeries.last),
  ];
}

/// A readable body for every published episode of every fixture series, each
/// carrying the episodes either side of it the way `GetEpisodeDetail` does.
Map<String, EpisodeDetail> fixtureEpisodes({
  EpisodeAccess access = EpisodeAccess.free,
  int pageCount = 3,
  SeriesAgeRating? ageRating,
  EpisodePurchaseSurface paidSurface = EpisodePurchaseSurface.all,
}) {
  final bodies = <String, EpisodeDetail>{};
  for (final item in fixtureSeries) {
    final episodes = fixtureDetail(item, paidSurface: paidSurface).episodes;
    for (var index = 0; index < episodes.length; index++) {
      final episode = episodes[index];
      bodies[episodeKey(item.id, episode.id)] = EpisodeDetail(
        episode: episode,
        seriesId: item.id,
        seriesTitle: item.title,
        access: access,
        previousEpisode: index == 0
            ? null
            : fixtureNeighbor(episodes[index - 1]),
        nextEpisode: index == episodes.length - 1
            ? null
            : fixtureNeighbor(episodes[index + 1]),
        images: [
          for (var page = 1; page <= pageCount; page++)
            EpisodeImageItem(
              id: '${episode.id}-page-$page',
              url: Uri.parse(
                'http://127.0.0.1:8200/images/episodes/${episode.id}-page-$page',
              ),
              displayOrder: page,
              width: 800,
              height: 1200,
            ),
        ],
        ageRating: ageRating,
      );
    }
  }
  return bodies;
}

/// The offer an episode beside [episode] makes to open it. A fixture episode
/// is free exactly while it costs nothing, because no free window is open on
/// any of them.
EpisodeNeighbor fixtureNeighbor(EpisodeItem episode) => EpisodeNeighbor(
  id: episode.id,
  title: episode.title,
  orderIndex: episode.orderIndex,
  price: episode.price,
  isFree: episode.price == 0,
  purchaseSurface: episode.purchaseSurface,
);
