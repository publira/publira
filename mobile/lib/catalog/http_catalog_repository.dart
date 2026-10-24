import 'dart:async';

import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/api/unknown_enum.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/campaign_banner.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_classification.dart';
import 'package:publira/models/series_item.dart';

/// [CatalogRepository] backed by the public Connect API.
class HttpCatalogRepository implements CatalogRepository {
  factory HttpCatalogRepository({
    required AppConfig config,
    ConnectClient? client,
    TenantResolver? tenants,
  }) {
    final resolved = client ?? ConnectClient(baseUrl: config.baseUrl);
    return HttpCatalogRepository._(
      config: config,
      client: resolved,
      tenants:
          tenants ??
          TenantResolver(client: resolved, tenantHost: config.tenantHost),
    );
  }

  HttpCatalogRepository._({
    required this.config,
    required this._client,
    required this._tenants,
  });

  /// `Series.age_rating`'s field number.
  static const _ageRatingField = 15;

  final AppConfig config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  pb.CatalogServiceApi get _catalog => pb.CatalogServiceApi(_client);
  pb.EpisodeReadServiceApi get _reads => pb.EpisodeReadServiceApi(_client);
  pb.RatingServiceApi get _ratings => pb.RatingServiceApi(_client);

  final _readingProgressWrites = StreamController<void>.broadcast();

  @override
  Stream<void> get readingProgressWrites => _readingProgressWrites.stream;

  final _reactionWrites = StreamController<void>.broadcast();

  @override
  Stream<void> get reactionWrites => _reactionWrites.stream;

  /// How many series one catalog page holds, which is also the API's own
  /// fallback for a request naming no limit.
  static const seriesPageLimit = 20;

  @override
  Future<SeriesPage> listSeries({required String locale, String token = ''}) =>
      _listPublishedSeries(
        seriesPageLimit,
        pb.SeriesOrder.SERIES_ORDER_TITLE_ASC,
        locale: locale,
        token: token,
      );

  /// How many results one page of every search holds, which is also the API's
  /// own fallback for a request naming no limit.
  static const searchPageLimit = 20;

  @override
  Future<SeriesPage> searchSeries({
    required String query,
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.searchPublishedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.SearchPublishedSeriesRequest(
          limit: searchPageLimit,
          locale: locale,
          query: query,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _seriesPage(body.series, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<CreatorPage> searchCreators({
    required String query,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.searchPublishedCreators(
        ConnectCallContext(tenantId: tenantId),
        pb.SearchPublishedCreatorsRequest(
          limit: searchPageLimit,
          query: query,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _creatorPage(body.creators, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<LabelPage> searchLabels({
    required String query,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.searchPublishedLabels(
        ConnectCallContext(tenantId: tenantId),
        pb.SearchPublishedLabelsRequest(
          limit: searchPageLimit,
          query: query,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _labelPage(body.labels, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<CreatorPage> listCreators({
    int limit = directoryPageLimit,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listPublishedCreators(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedCreatorsRequest(
          limit: limit,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _creatorPage(body.creators, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<LabelPage> listLabels({
    int limit = directoryPageLimit,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listPublishedLabels(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedLabelsRequest(
          limit: limit,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _labelPage(body.labels, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// A page of `PublishedCreator`, as a creator search and the author list
  /// both answer.
  CreatorPage _creatorPage(
    List<pb.PublishedCreator> creators,
    String nextToken,
  ) {
    return CreatorPage(
      creators: creators
          .map((creator) => _publishedCreator(creator, 'creators[]'))
          .toList(growable: false),
      nextToken: nextToken.trim(),
    );
  }

  /// A page of `PublishedLabel`, as a label search and the label list both
  /// answer.
  LabelPage _labelPage(List<pb.PublishedLabel> labels, String nextToken) {
    return LabelPage(
      labels: labels
          .map((label) => _publishedLabel(label, 'labels[]', counted: false))
          .toList(growable: false),
      nextToken: nextToken.trim(),
    );
  }

  @override
  Future<List<SeriesItem>> listNewestSeries({
    required int limit,
    required String locale,
  }) async {
    final page = await _listPublishedSeries(
      limit,
      pb.SeriesOrder.SERIES_ORDER_PUBLISHED_AT_DESC,
      locale: locale,
    );
    return page.series;
  }

  /// One page of `ListPublishedSeries`, in [order].
  ///
  /// The order is always stated rather than left to the API's default, because
  /// the catalog screen shows two pages of this list at once — the newest few
  /// above the whole of it — and it is the orders that tell them apart.
  Future<SeriesPage> _listPublishedSeries(
    int limit,
    pb.SeriesOrder order, {
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listPublishedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedSeriesRequest(
          limit: limit,
          locale: locale,
          order: order,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _seriesPage(body.series, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<RankedSeriesPage> listRankedSeries({
    required int limit,
    required RankingPeriod period,
    required SeriesAgeRating ageRating,
    required String locale,
    String genreId = '',
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listRankedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.ListRankedSeriesRequest(
          ageRating: switch (ageRating) {
            SeriesAgeRating.all => pb.SeriesAgeRating.SERIES_AGE_RATING_ALL,
            SeriesAgeRating.r15 => pb.SeriesAgeRating.SERIES_AGE_RATING_R15,
            SeriesAgeRating.r18 => pb.SeriesAgeRating.SERIES_AGE_RATING_R18,
            SeriesAgeRating.unknown => throw ArgumentError.value(
              ageRating,
              'ageRating',
              'names no ranking',
            ),
          },
          genrePublicId: genreId.isEmpty ? null : genreId,
          limit: limit,
          locale: locale,
          period: switch (period) {
            RankingPeriod.daily => pb.RankingPeriod.RANKING_PERIOD_DAILY,
            RankingPeriod.weekly => pb.RankingPeriod.RANKING_PERIOD_WEEKLY,
          },
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return RankedSeriesPage(
        rankedSeries: _parseRankedSeries(body.rankedSeries),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesPage> listRecommendedSeries({
    required int limit,
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listRecommendedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.ListRecommendedSeriesRequest(
          limit: limit,
          locale: locale,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _seriesPage(body.series, body.nextToken);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesPage> listMyRecommendedSeries({
    required int limit,
    required String locale,
    String token = '',
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return listRecommendedSeries(limit: limit, locale: locale, token: token);
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listMyRecommendedSeries(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyRecommendedSeriesRequest(
          limit: limit,
          locale: locale,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _seriesPage(body.series, body.nextToken);
    } on ConnectException catch (error) {
      if (error.code != 'unauthenticated') {
        throw _toFailure(error);
      }
    }
    // The token is handed on as it is: one the tenant's order cannot read is
    // refused there, which starts the list again from its first page.
    return listRecommendedSeries(limit: limit, locale: locale, token: token);
  }

  /// The wire format omits an empty repeated field, which is how a tenant the
  /// ranking batch has not run for yet arrives.
  List<RankedSeriesItem> _parseRankedSeries(List<pb.RankedSeries> ranked) {
    final items = ranked
        .map(
          (item) => RankedSeriesItem(
            rank: item.rank,
            series: _series(item.series, 'rankedSeries[].series'),
          ),
        )
        .toList();
    return List<RankedSeriesItem>.unmodifiable(items);
  }

  @override
  Future<List<SeriesItem>> listRelatedSeries(
    String seriesInternalId, {
    required int limit,
    required String locale,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listRelatedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.ListRelatedSeriesRequest(
          limit: limit,
          locale: locale,
          seriesId: seriesInternalId,
          surface: appClientSurface,
          tenant: _tenant(tenantId),
        ),
      );
      return _parseSeriesList(body.series);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return const [];
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesDetail?> getSeries(
    String publicId, {
    required String locale,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.getSeriesDetail(
        ConnectCallContext(tenantId: tenantId),
        pb.GetSeriesDetailRequest(
          locale: locale,
          publicId: publicId,
          surface: appClientSurface,
          tenant: _tenant(tenantId),
        ),
      );
      return _parseSeriesDetail(body);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesTitle?> getSeriesTitle(
    String publicId, {
    required String locale,
  }) async {
    final series = (await getSeries(publicId, locale: locale))?.series;
    return series == null ? null : (title: series.title, locale: series.locale);
  }

  @override
  Future<SeriesCreator?> getCreator(String publicId) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.getPublishedCreatorDetail(
        ConnectCallContext(tenantId: tenantId),
        pb.GetPublishedCreatorDetailRequest(
          // The response carries a page of the creator's published series,
          // which a follow row does not show; one is asked for because the API
          // falls back to twenty.
          limit: 1,
          publicId: publicId,
          surface: appClientSurface,
          tenant: _tenant(tenantId),
        ),
      );
      if (!body.hasCreator()) {
        _invalidPayload('creator must be an object');
      }
      final creator = body.creator;
      return SeriesCreator(
        id: creator.publicId.trim(),
        internalId: creator.id.trim(),
        name: creator.name.trim(),
      );
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  /// How many series one page of an author's or a label's list holds, which
  /// is also the API's own fallback for a request naming no limit.
  static const detailSeriesPageLimit = 20;

  @override
  Future<CreatorDetail?> getCreatorDetail(
    String publicId, {
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.getPublishedCreatorDetail(
        ConnectCallContext(tenantId: tenantId),
        pb.GetPublishedCreatorDetailRequest(
          limit: detailSeriesPageLimit,
          locale: locale,
          publicId: publicId,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return CreatorDetail(
        creator: _publishedCreator(body.creator, 'creator'),
        series: _seriesPage(body.series, body.nextToken),
      );
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<LabelDetail?> getLabelDetail(
    String publicId, {
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.getPublishedLabelDetail(
        ConnectCallContext(tenantId: tenantId),
        pb.GetPublishedLabelDetailRequest(
          limit: detailSeriesPageLimit,
          locale: locale,
          publicId: publicId,
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return LabelDetail(
        label: _publishedLabel(body.label, 'label', counted: true),
        series: _seriesPage(body.series, body.nextToken),
      );
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  PublishedCreator _publishedCreator(pb.PublishedCreator creator, String path) {
    final iconUrl = creator.iconImageUrl.trim();
    return PublishedCreator(
      id: _requiredId(creator.publicId, '$path.publicId'),
      internalId: creator.id.trim(),
      name: creator.name.trim(),
      profileText: creator.profileText.trim(),
      // The wire format omits an empty string, which is a creator with no
      // portrait.
      iconUrl: iconUrl.isEmpty ? null : config.imageUri(iconUrl),
      imageRequestHeaders: config.publicImageRequestHeaders,
      seriesCount: _count(
        creator.publishedSeriesCount,
        '$path.publishedSeriesCount',
      ),
    );
  }

  /// A `PublishedLabel`, carrying the count of its published series only
  /// when [counted].
  PublishedLabel _publishedLabel(
    pb.PublishedLabel label,
    String path, {
    required bool counted,
  }) {
    return PublishedLabel(
      id: _requiredId(label.publicId, '$path.publicId'),
      name: label.name.trim(),
      eyeCatchVariants: _parseEyeCatchVariants(
        label.eyeCatchImageVariants,
        path,
      ),
      imageRequestHeaders: config.publicImageRequestHeaders,
      seriesCount: counted
          ? _count(label.publishedSeriesCount, '$path.publishedSeriesCount')
          : null,
    );
  }

  /// How many genres or tags one page of their lists holds: the API's
  /// largest, since a whole list is walked to answer one read.
  static const classificationPageLimit = 100;

  @override
  Future<List<PublishedGenre>> listGenres({required String locale}) async {
    try {
      final genres = <PublishedGenre>[];
      await _walkClassification<pb.PublishedGenre>(
        (tenantId, token) async {
          final body = await _catalog.listPublishedGenres(
            ConnectCallContext(tenantId: tenantId),
            pb.ListPublishedGenresRequest(
              limit: classificationPageLimit,
              surface: appClientSurface,
              token: _pageToken(token),
              tenant: _tenant(tenantId),
              locale: locale,
            ),
          );
          return (body.genres, body.nextToken);
        },
        (genre) {
          genres.add(
            PublishedGenre(
              id: _requiredId(genre.publicId, 'genres[].publicId'),
              name: genre.name.trim(),
              locale: genre.locale.trim(),
              seriesCount: _count(
                genre.publishedSeriesCount,
                'genres[].publishedSeriesCount',
              ),
              featuredSeries: _parseGenreFeaturedSeries(genre.featuredSeries),
              eyeCatchVariants: _parseEyeCatchVariants(
                genre.eyeCatchImageVariants,
                'genres[]',
              ),
              imageRequestHeaders: config.publicImageRequestHeaders,
            ),
          );
          return false;
        },
      );
      return List<PublishedGenre>.unmodifiable(genres);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<GenreFeaturedSeries> _parseGenreFeaturedSeries(
    List<pb.PublishedGenreFeaturedSeries> featured,
  ) {
    const path = 'genres[].featuredSeries[]';
    final series = featured
        .map(
          (item) => GenreFeaturedSeries(
            id: item.publicId.trim(),
            eyeCatchVariants: _parseEyeCatchVariants(
              item.eyeCatchImageVariants,
              path,
            ),
          ),
        )
        // An entry with no id names no series, and the site drops it too.
        .where((series) => series.id.isNotEmpty)
        .toList();
    return List<GenreFeaturedSeries>.unmodifiable(series);
  }

  @override
  Future<List<CampaignBanner>> listCampaignBanners() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listCampaignBanners(
        ConnectCallContext(tenantId: tenantId),
        pb.ListCampaignBannersRequest(tenant: _tenant(tenantId)),
      );
      return List<CampaignBanner>.unmodifiable(
        body.banners.map(
          (banner) => CampaignBanner(
            id: _requiredId(banner.publicId, 'banners[].publicId'),
            linkUrl: banner.linkUrl.trim(),
            altText: banner.altText.trim(),
            imageVariants: _parseEyeCatchVariants(
              banner.imageVariants,
              'banners[]',
              field: 'imageVariants',
            ),
            imageRequestHeaders: config.publicImageRequestHeaders,
          ),
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<PublishedTag?> getTag(String slug) async {
    try {
      PublishedTag? match;
      // `ListPublishedTags` is the only read that names a tag, so the list is
      // walked until the slug turns up, the way the storefront finds one.
      await _walkClassification<pb.PublishedTag>(
        (tenantId, token) async {
          final body = await _catalog.listPublishedTags(
            ConnectCallContext(tenantId: tenantId),
            pb.ListPublishedTagsRequest(
              limit: classificationPageLimit,
              surface: appClientSurface,
              token: _pageToken(token),
              tenant: _tenant(tenantId),
            ),
          );
          return (body.tags, body.nextToken);
        },
        (tag) {
          if (tag.slug.trim() != slug) {
            return false;
          }
          match = PublishedTag(
            slug: slug,
            name: tag.name.trim(),
            seriesCount: _count(
              tag.publishedSeriesCount,
              'tags[].publishedSeriesCount',
            ),
          );
          return true;
        },
      );
      return match;
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// Reads every page [readPage] answers, handing each row to [visit] until
  /// it answers `true`.
  Future<void> _walkClassification<T>(
    Future<(List<T> rows, String nextToken)> Function(
      String tenantId,
      String token,
    )
    readPage,
    bool Function(T row) visit,
  ) async {
    final tenantId = await _tenants.resolve();
    var token = '';
    do {
      final (rows, nextToken) = await readPage(tenantId, token);
      for (final row in rows) {
        if (visit(row)) {
          return;
        }
      }
      token = nextToken.trim();
    } while (token.isNotEmpty);
  }

  @override
  Future<SeriesPage?> listGenreSeries(
    String genreId, {
    required String locale,
    SeriesListFilter filter = const SeriesListFilter(),
    String token = '',
  }) => _listClassifiedSeries(
    filter,
    token,
    locale: locale,
    genrePublicId: genreId,
  );

  @override
  Future<SeriesPage?> listTagSeries(
    String slug, {
    required String locale,
    SeriesListFilter filter = const SeriesListFilter(),
    String token = '',
  }) => _listClassifiedSeries(filter, token, locale: locale, tagSlug: slug);

  /// One page of `ListPublishedSeries` narrowed to one genre or one tag, which
  /// the API answers `not_found` for when the tenant has no such one.
  Future<SeriesPage?> _listClassifiedSeries(
    SeriesListFilter filter,
    String token, {
    required String locale,
    String? genrePublicId,
    String? tagSlug,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.listPublishedSeries(
        ConnectCallContext(tenantId: tenantId),
        pb.ListPublishedSeriesRequest(
          genrePublicId: genrePublicId,
          tagSlug: tagSlug,
          hasFreeEpisodes: filter.freeOnly ? true : null,
          limit: detailSeriesPageLimit,
          locale: locale,
          order: _seriesOrder(filter.order),
          status: switch (filter.status) {
            final status? => _wireStatus(status),
            null => null,
          },
          surface: appClientSurface,
          token: _pageToken(token),
          tenant: _tenant(tenantId),
        ),
      );
      return _seriesPage(body.series, body.nextToken);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  /// The `publira.v1.SeriesOrder` the API is asked for.
  static pb.SeriesOrder _seriesOrder(SeriesListOrder order) => switch (order) {
    SeriesListOrder.newest => pb.SeriesOrder.SERIES_ORDER_PUBLISHED_AT_DESC,
    SeriesListOrder.updated =>
      pb.SeriesOrder.SERIES_ORDER_LATEST_EPISODE_AT_DESC,
    SeriesListOrder.title => pb.SeriesOrder.SERIES_ORDER_TITLE_ASC,
  };

  static pb.SeriesStatus _wireStatus(SeriesStatus status) => switch (status) {
    SeriesStatus.ongoing => pb.SeriesStatus.SERIES_STATUS_ONGOING,
    SeriesStatus.completed => pb.SeriesStatus.SERIES_STATUS_COMPLETED,
    SeriesStatus.hiatus => pb.SeriesStatus.SERIES_STATUS_HIATUS,
  };

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId, {
    required String locale,
  }) async {
    // Read before the first await, as the reads of the reader's own history
    // are: what a body grants belongs to the session that asked for it, and
    // the caller files it under the reader it read at this same instant.
    final accessToken = _client.accessToken;
    try {
      final tenantId = await _tenants.resolve();
      final body = await _catalog.getEpisodeDetail(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.GetEpisodeDetailRequest(
          locale: locale,
          publicId: episodePublicId,
          surface: appClientSurface,
          tenant: _tenant(tenantId),
        ),
      );
      return _parseEpisodeDetail(body, seriesPublicId, accessToken);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<int?> getReadingPosition(
    String seriesPublicId,
    String episodePublicId, {
    required String episodeInternalId,
  }) async {
    // A guest holds no session, and every one of these RPCs answers a request
    // without one `unauthenticated`. Asking anyway would spend a round trip on
    // the answer the viewer already has: the first page.
    //
    // The token is read here and sent explicitly rather than left for the
    // client to resolve at request time, which is what ties the answer to the
    // reader the caller asked about: a sign-out and a second sign-in while the
    // tenant lookup is in flight would otherwise file one reader's page under
    // the other. Every read of the reader's own history does the same.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return null;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _reads.getMyReadingPosition(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.GetMyReadingPositionRequest(
          episodeId: episodeInternalId,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      // The wire format omits an unset message, which is the answer for a
      // reader who never opened the episode and for one who may no longer read
      // it.
      if (!body.hasPosition()) {
        return null;
      }
      return body.position.pageIndex;
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex, {
    required String episodeInternalId,
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return;
    }
    try {
      final tenantId = await _tenants.resolve();
      await _reads.saveReadingPosition(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.SaveReadingPositionRequest(
          episodeId: episodeInternalId,
          pageIndex: pageIndex,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      _readingProgressWrites.add(null);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> markEpisodeAsRead(
    String episodePublicId, {
    required String episodeInternalId,
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return;
    }
    try {
      final tenantId = await _tenants.resolve();
      await _reads.markEpisodeAsRead(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.MarkEpisodeAsReadRequest(
          episodeId: episodeInternalId,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      _readingProgressWrites.add(null);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeReaction?> getEpisodeReaction(String episodeInternalId) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return null;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _ratings.getMyEpisodeRating(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.GetMyEpisodeRatingRequest(
          episodeId: episodeInternalId,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      return _reaction(
        score: body.score,
        ratingCount: body.ratingCount.toInt(),
        mode: body.mode,
        readerCredited: body.readerCredited,
        readerIsStaff: body.readerIsStaff,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeReaction> reactToEpisode(String episodeInternalId) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const CatalogFailure(
        CatalogFailureKind.unexpected,
        message: 'episode reactions require a session',
      );
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _ratings.rateEpisode(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.RateEpisodeRequest(
          episodeId: episodeInternalId,
          presses: 1,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      _reactionWrites.add(null);
      return _reaction(
        score: body.score,
        ratingCount: body.ratingCount.toInt(),
        mode: body.mode,
        // RateEpisode never carries either: a credited reader and a member
        // of staff are refused before there is a response to read.
        readerCredited: false,
        readerIsStaff: false,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesProgress> getSeriesProgress(
    String seriesInternalId, {
    required String locale,
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return SeriesProgress.none;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _reads.getMySeriesProgress(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.GetMySeriesProgressRequest(
          locale: locale,
          seriesId: seriesInternalId,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      final finishedEpisodeIds = <String>{
        for (final id in body.finishedEpisodePublicIds)
          _requiredId(id, 'finishedEpisodePublicIds[]'),
      };
      // The wire format omits an unset message, which is the answer for a
      // reader who has opened no episode of the series they can still read.
      if (!body.hasProgress()) {
        return SeriesProgress(finishedEpisodeIds: finishedEpisodeIds);
      }
      final progress = body.progress;
      return SeriesProgress(
        episode: _episode(progress.episode, 'progress.episode'),
        isFinished: progress.isFinished,
        finishedEpisodeIds: finishedEpisodeIds,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<double?> getMySeriesRating(String seriesInternalId) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return null;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _ratings.getMySeriesRating(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.GetMySeriesRatingRequest(
          seriesId: seriesInternalId,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
        ),
      );
      // The average of no scores is 0, which is not a rating of 0: only the
      // count tells a reader who reacted to nothing from one who did.
      if (body.ratedEpisodeCount <= 0) {
        return null;
      }
      return _rating(body.ratingAverage, 'response.ratingAverage');
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    required String locale,
    String token = '',
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return RecentSeriesPage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _reads.listMyRecentSeries(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyRecentSeriesRequest(
          limit: limit,
          locale: locale,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
          token: _pageToken(token),
        ),
      );
      return RecentSeriesPage(
        series: _parseRecentSeries(body.series),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeReadPage> listEpisodeReads({
    required int limit,
    required String locale,
    String token = '',
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return EpisodeReadPage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _reads.listMyEpisodeReads(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyEpisodeReadsRequest(
          limit: limit,
          locale: locale,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
          token: _pageToken(token),
        ),
      );
      return EpisodeReadPage(
        reads: _parseEpisodeReads(body.reads),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<EpisodeReadItem> _parseEpisodeReads(List<pb.MyEpisodeRead> reads) {
    final items = reads
        .map(
          (read) => EpisodeReadItem(
            series: _series(read.series, 'reads[].series'),
            episode: _episode(read.episode, 'reads[].episode'),
            readAt: DateTime.tryParse(read.readAt.trim())?.toLocal(),
          ),
        )
        .toList();
    return List<EpisodeReadItem>.unmodifiable(items);
  }

  @override
  Future<FollowUpdatePage> listFollowUpdates({
    required int limit,
    required String locale,
    String token = '',
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return FollowUpdatePage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.FollowServiceApi(_client).listMyFollowUpdates(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyFollowUpdatesRequest(
          limit: limit,
          locale: locale,
          tenant: _tenant(tenantId),
          surface: appClientSurface,
          token: _pageToken(token),
        ),
      );
      return FollowUpdatePage(
        updates: _parseFollowUpdates(body.updates),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<FollowUpdateItem> _parseFollowUpdates(List<pb.FollowUpdate> updates) {
    final items = updates
        .map(
          (update) => FollowUpdateItem(
            series: _series(update.series, 'updates[].series'),
            episode: _episode(update.episode, 'updates[].episode'),
            publishedAt: DateTime.tryParse(
              update.episode.publishedAt.trim(),
            )?.toLocal(),
          ),
        )
        .toList();
    return List<FollowUpdateItem>.unmodifiable(items);
  }

  List<RecentSeriesItem> _parseRecentSeries(List<pb.RecentSeries> recent) {
    final items = recent
        .map(
          (item) => RecentSeriesItem(
            series: _series(item.series, 'series[].series'),
            episode: _episode(item.episode, 'series[].episode'),
          ),
        )
        .toList();
    return List<RecentSeriesItem>.unmodifiable(items);
  }

  CatalogFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return CatalogFailure(CatalogFailureKind.network, message: error.message);
    }
    return CatalogFailure(
      error.code == 'unauthenticated'
          ? CatalogFailureKind.sessionExpired
          : CatalogFailureKind.unexpected,
      message: error.message,
      refused: _refusalCodes.contains(error.code),
      reasons: error.reasons,
    );
  }

  /// Connect codes that answer the request itself rather than the server's
  /// state, so the same request is answered the same way every time.
  static const _refusalCodes = {
    'invalid_argument',
    'not_found',
    'permission_denied',
    'failed_precondition',
    'out_of_range',
    'already_exists',
  };

  /// The tenant every request names in its body as well as in its header.
  static pb.TenantContext _tenant(String tenantId) =>
      pb.TenantContext(tenantId: tenantId);

  /// [token] is left off an empty request the way the wire format leaves off a
  /// default, which is what asks for the first page.
  static String? _pageToken(String token) => token.isEmpty ? null : token;

  /// A page of series. The wire format omits an empty string, which is how the
  /// last page arrives.
  SeriesPage _seriesPage(List<pb.Series> series, String nextToken) {
    return SeriesPage(
      series: _parseSeriesList(series),
      nextToken: nextToken.trim(),
    );
  }

  List<SeriesItem> _parseSeriesList(List<pb.Series> series) {
    return series
        .map((item) => _series(item, 'series[]'))
        .toList(growable: false);
  }

  SeriesDetail _parseSeriesDetail(pb.GetSeriesDetailResponse body) {
    final series = _series(body.series, 'series');
    final episodes = _parseEpisodes(body.episodes);
    return SeriesDetail(
      series: series.copyWith(episodeCount: episodes.length),
      episodes: episodes,
      // The wire format omits the unset message, which is how a series without
      // the rule arrives.
      waitFree: body.hasWaitFree() ? _parseWaitFreeRule(body.waitFree) : null,
      volumes: _parseVolumes(body.volumes),
    );
  }

  /// A volume naming no episode the app lists has nothing to sell, and the API
  /// leaves such a volume out; one that slips through is left out here too.
  List<VolumeItem> _parseVolumes(List<pb.Volume> volumes) {
    final parsed = [
      for (final volume in volumes)
        if (volume.episodeIds.any((id) => id.trim().isNotEmpty))
          VolumeItem(
            id: _requiredId(volume.id, 'volumes[].id'),
            publicId: _requiredId(volume.publicId, 'volumes[].publicId'),
            title: volume.title.trim(),
            orderIndex: volume.orderIndex,
            price: volume.price,
            episodeIds: List<String>.unmodifiable([
              for (final id in volume.episodeIds)
                if (id.trim().isNotEmpty) id.trim(),
            ]),
            coverVariants: _parseEyeCatchVariants(
              volume.coverImageVariants,
              'volumes[]',
              field: 'coverImageVariants',
            ),
          ),
    ];
    parsed.sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return List<VolumeItem>.unmodifiable(parsed);
  }

  WaitFreeRule _parseWaitFreeRule(pb.WaitFreeRule rule) {
    return WaitFreeRule(
      rechargeHours: rule.rechargeHours,
      accessHours: rule.accessHours,
      excludedEpisodeIds: Set.unmodifiable({
        for (final id in rule.excludedEpisodeIds)
          if (id.isNotEmpty) id,
      }),
    );
  }

  SeriesItem _series(pb.Series series, String path) {
    // The wire format omits an unset message, which is an unlabelled series and
    // reads as a label with empty fields.
    final label = series.label;
    return SeriesItem(
      id: _requiredId(series.publicId, '$path.publicId'),
      internalId: series.id.trim(),
      title: series.title.trim(),
      description: series.synopsis.trim(),
      locale: series.locale.trim(),
      labelId: label.publicId.trim(),
      labelName: label.name.trim(),
      creators: _parseCreators(series.creators),
      eyeCatchVariants: _parseEyeCatchVariants(
        series.eyeCatchImageVariants,
        path,
      ),
      imageRequestHeaders: config.publicImageRequestHeaders,
      status: _parseStatus(series.status),
      scheduleWeekdays: _parseScheduleWeekdays(series.scheduleWeekdays),
      ageRating: _parseAgeRating(series),
      genres: _parseGenres(series.genres),
      tags: _parseTags(series.tags),
      ratingAverage: _rating(series.ratingAverage, '$path.ratingAverage'),
      ratingCount: _count(series.ratingCount.toInt(), '$path.ratingCount'),
    );
  }

  /// The zero value, and a value this build does not know, are both a series
  /// the tenant has not classified.
  SeriesStatus? _parseStatus(pb.SeriesStatus status) {
    return switch (status) {
      pb.SeriesStatus.SERIES_STATUS_ONGOING => SeriesStatus.ongoing,
      pb.SeriesStatus.SERIES_STATUS_COMPLETED => SeriesStatus.completed,
      pb.SeriesStatus.SERIES_STATUS_HIATUS => SeriesStatus.hiatus,
      _ => null,
    };
  }

  /// The wire format omits the zero value, which is a series nobody rated. A
  /// rating this build does not know is [SeriesAgeRating.unknown], so a future
  /// rating cannot open as unrestricted.
  SeriesAgeRating? _parseAgeRating(pb.Series series) {
    if (carriesUnknownEnum(series, _ageRatingField)) {
      return SeriesAgeRating.unknown;
    }
    return switch (series.ageRating) {
      pb.SeriesAgeRating.SERIES_AGE_RATING_ALL => SeriesAgeRating.all,
      pb.SeriesAgeRating.SERIES_AGE_RATING_R15 => SeriesAgeRating.r15,
      pb.SeriesAgeRating.SERIES_AGE_RATING_R18 => SeriesAgeRating.r18,
      _ => null,
    };
  }

  List<int> _parseScheduleWeekdays(List<int> weekdays) {
    // A number outside Sunday–Saturday is dropped rather than named: the
    // weekday formatter would write it out as the digit it is.
    return List<int>.unmodifiable(
      weekdays.where((weekday) => weekday >= 0 && weekday <= 6),
    );
  }

  List<SeriesGenre> _parseGenres(List<pb.Genre> genres) {
    final parsed = genres
        .map(
          (genre) => SeriesGenre(
            id: genre.publicId.trim(),
            name: genre.name.trim(),
            locale: genre.locale.trim(),
          ),
        )
        // A genre with no name or no public id is nothing a reader can be
        // shown, and the site drops it from the same field for the same
        // reason.
        .where((genre) => genre.id.isNotEmpty && genre.name.isNotEmpty)
        .toList();
    return List<SeriesGenre>.unmodifiable(parsed);
  }

  List<SeriesTag> _parseTags(List<pb.Tag> tags) {
    final parsed = tags
        .map((tag) => SeriesTag(slug: tag.slug.trim(), name: tag.name.trim()))
        // A tag without a slug leads nowhere, for the reason a genre without
        // a public id does.
        .where((tag) => tag.slug.isNotEmpty && tag.name.isNotEmpty)
        .toList();
    return List<SeriesTag>.unmodifiable(parsed);
  }

  List<SeriesCreator> _parseCreators(List<pb.Creator> creators) {
    final parsed = creators
        .map(
          (creator) => SeriesCreator(
            id: creator.publicId.trim(),
            internalId: creator.id.trim(),
            name: creator.name.trim(),
            // The wire format omits an unset message, which is a credit written
            // before the tenant curated any role, and names no role.
            roleName: creator.role.name.trim(),
          ),
        )
        // A nameless credit is nothing a reader can be shown, and the site
        // drops it from the same field for the same reason.
        .where((creator) => creator.name.isNotEmpty)
        .toList();
    return List<SeriesCreator>.unmodifiable(parsed);
  }

  /// [variants], read from the field [field] of the message at [path].
  List<EyeCatchVariant> _parseEyeCatchVariants(
    List<pb.SeriesEyeCatchVariant> variants,
    String path, {
    String field = 'eyeCatchImageVariants',
  }) {
    final variantPath = '$path.$field[]';
    final parsed = variants
        .map(
          (variant) => EyeCatchVariant(
            variantType: variant.variantType.trim(),
            url: config.imageUri(_requiredId(variant.url, '$variantPath.url')),
            width: variant.width,
            height: variant.height,
          ),
        )
        .toList();
    return List<EyeCatchVariant>.unmodifiable(parsed);
  }

  List<EpisodeItem> _parseEpisodes(List<pb.Episode> episodes) {
    final parsed = episodes
        .map((episode) => _episode(episode, 'episodes[]'))
        .toList();
    parsed.sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return List<EpisodeItem>.unmodifiable(parsed);
  }

  EpisodeItem _episode(pb.Episode episode, String path) {
    return EpisodeItem(
      id: _requiredId(episode.publicId, '$path.publicId'),
      internalId: episode.id.trim(),
      title: episode.title.trim(),
      locale: episode.locale.trim(),
      orderIndex: episode.orderIndex,
      price: episode.price,
      rentalPrice: episode.rentalPrice,
      rentalPeriodHours: episode.rentalPeriodHours,
      purchaseSurface: _purchaseSurface(episode.purchaseAvailability),
      ratingCount: _count(episode.ratingCount.toInt(), '$path.ratingCount'),
      // The wire format omits an empty string, which is an episode no window
      // holds.
      freeUntil: DateTime.tryParse(episode.freeUntil.trim())?.toLocal(),
      campaign: _campaign(episode.campaignPrice, episode.campaignEndsAt),
      eyeCatchVariants: _parseEyeCatchVariants(
        episode.eyeCatchImageVariants,
        path,
      ),
    );
  }

  /// The zero value, and a value this build does not know, are read as
  /// [EpisodePurchaseSurface.all], since the server still refuses a checkout
  /// it forbids.
  static EpisodePurchaseSurface _purchaseSurface(
    pb.SurfaceAvailability availability,
  ) {
    return switch (availability) {
      pb.SurfaceAvailability.SURFACE_AVAILABILITY_WEB =>
        EpisodePurchaseSurface.web,
      pb.SurfaceAvailability.SURFACE_AVAILABILITY_APP =>
        EpisodePurchaseSurface.app,
      _ => EpisodePurchaseSurface.all,
    };
  }

  /// Builds the reader's view of one episode.
  ///
  /// The series is checked here rather than trusted from the route: an episode
  /// public id addresses the episode alone, so a mismatched pair would
  /// otherwise render one series' body under another series' URL.
  ///
  /// Its pages are requested with [accessToken], the session the body was
  /// granted to.
  EpisodeDetail? _parseEpisodeDetail(
    pb.GetEpisodeDetailResponse body,
    String seriesPublicId,
    String accessToken,
  ) {
    final series = body.series;
    final seriesId = _requiredId(series.publicId, 'series.publicId');
    if (seriesId != seriesPublicId) {
      return null;
    }
    final episode = body.episode;
    return EpisodeDetail(
      episode: _episode(episode, 'episode'),
      seriesId: seriesId,
      seriesInternalId: series.id.trim(),
      seriesTitle: series.title.trim(),
      seriesLocale: series.locale.trim(),
      seriesEyeCatchVariants: _parseEyeCatchVariants(
        series.eyeCatchImageVariants,
        'series',
      ),
      access: EpisodeAccess.fromWire(body.access),
      images: _parseEpisodeImages(body.images, 'images'),
      previewImages: _parseEpisodeImages(body.previewImages, 'previewImages'),
      entitlementSource: EpisodeEntitlementSource.fromWire(
        body.entitlementSource,
      ),
      previousEpisode: _neighbor(
        body.hasPreviousEpisode(),
        body.previousEpisode,
      ),
      nextEpisode: _neighbor(body.hasNextEpisode(), body.nextEpisode),
      nextFreeEpisode: _neighbor(
        body.hasNextFreeEpisode(),
        body.nextFreeEpisode,
      ),
      imageRequestHeaders: config.imageRequestHeaders(accessToken),
      previewImageRequestHeaders: config.publicImageRequestHeaders,
      ageRating: _parseAgeRating(series),
      creators: _parseCreators(episode.creators),
      readingDirection: _parseReadingDirection(episode.readingDirection),
      // The wire format omits a zero, which is pairing from the first page. A
      // never-edited series answers 1, so the field is present then.
      spreadStartIndex: _count(
        episode.spreadStartIndex,
        'episode.spreadStartIndex',
      ),
    );
  }

  /// One side of the episode, or `null` at that end of the series.
  ///
  /// The wire format omits an unset message, which is what the server sends
  /// where there is no episode on that side, and [present] is then `false`. A
  /// neighbour that names no episode is read the same way: nothing can be
  /// opened from it.
  EpisodeNeighbor? _neighbor(bool present, pb.EpisodeNeighbor neighbor) {
    if (!present) {
      return null;
    }
    final id = neighbor.publicId.trim();
    if (id.isEmpty) {
      return null;
    }
    return EpisodeNeighbor(
      id: id,
      title: neighbor.title.trim(),
      locale: neighbor.locale.trim(),
      orderIndex: neighbor.orderIndex,
      price: neighbor.price,
      isFree: neighbor.isFree,
      purchaseSurface: _purchaseSurface(neighbor.purchaseAvailability),
      campaign: _campaign(neighbor.campaignPrice, neighbor.campaignEndsAt),
    );
  }

  /// The campaign [price] and [endsAt] describe, or `null` for the zero values
  /// the API sends where no campaign is open. The wire format omits both
  /// then, and a read that carries no campaign leaves them unset too.
  static EpisodeCampaign? _campaign(int price, String endsAt) {
    final end = DateTime.tryParse(endsAt.trim());
    if (price <= 0 || end == null) {
      return null;
    }
    return EpisodeCampaign(price: price, endsAt: end.toLocal());
  }

  EpisodeReaction _reaction({
    required int score,
    required int ratingCount,
    required pb.EpisodeRatingMode mode,
    required bool readerCredited,
    required bool readerIsStaff,
  }) {
    return EpisodeReaction(
      score: score < 0 ? 0 : (score > 5 ? 5 : score),
      ratingCount: _count(ratingCount, 'reaction.ratingCount'),
      allowsMultiplePresses:
          mode == pb.EpisodeRatingMode.EPISODE_RATING_MODE_MULTIPLE,
      readerCredited: readerCredited,
      readerIsStaff: readerIsStaff,
    );
  }

  /// The zero value is unspecified and is read as right-to-left, the way a
  /// series nobody has set is laid out. A value this build does not know is
  /// read the same way rather than flipping the work.
  ReadingDirection _parseReadingDirection(pb.ReadingDirection direction) {
    return switch (direction) {
      pb.ReadingDirection.READING_DIRECTION_LEFT_TO_RIGHT =>
        ReadingDirection.ltr,
      _ => ReadingDirection.rtl,
    };
  }

  List<EpisodeImageItem> _parseEpisodeImages(
    List<pb.EpisodeImage> images,
    String path,
  ) {
    final item = '$path[]';
    final parsed = images
        .map(
          (image) => EpisodeImageItem(
            id: _requiredId(image.id, '$item.id'),
            url: config.imageUri(_requiredId(image.imageUrl, '$item.imageUrl')),
            displayOrder: image.displayOrder,
            width: image.width,
            height: image.height,
          ),
        )
        .toList();
    parsed.sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
    return List<EpisodeImageItem>.unmodifiable(parsed);
  }

  /// [value] trimmed, which the answer has to carry: an empty one fails the
  /// whole read.
  String _requiredId(String value, String path) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      _invalidPayload('$path must be a non-empty string');
    }
    return trimmed;
  }

  int _count(int value, String path) {
    if (value < 0) {
      _invalidPayload('$path must be a non-negative integer');
    }
    return value;
  }

  double _rating(double value, String path) {
    if (value.isFinite && value >= 0 && value <= 5) {
      return value;
    }
    _invalidPayload('$path must be a number between 0 and 5');
  }

  Never _invalidPayload(String message) {
    throw CatalogFailure(CatalogFailureKind.unexpected, message: message);
  }
}
