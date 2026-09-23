import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/published_label.dart';
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

  static const _listProcedure =
      '/publira.v1.CatalogService/ListPublishedSeries';
  static const _searchProcedure =
      '/publira.v1.CatalogService/SearchPublishedSeries';
  static const _searchCreatorsProcedure =
      '/publira.v1.CatalogService/SearchPublishedCreators';
  static const _searchLabelsProcedure =
      '/publira.v1.CatalogService/SearchPublishedLabels';
  static const _rankedProcedure = '/publira.v1.CatalogService/ListRankedSeries';
  static const _detailProcedure = '/publira.v1.CatalogService/GetSeriesDetail';
  static const _creatorProcedure =
      '/publira.v1.CatalogService/GetPublishedCreatorDetail';
  static const _labelProcedure =
      '/publira.v1.CatalogService/GetPublishedLabelDetail';
  static const _episodeProcedure =
      '/publira.v1.CatalogService/GetEpisodeDetail';
  static const _readingPositionProcedure =
      '/publira.v1.EpisodeReadService/GetMyReadingPosition';
  static const _saveReadingPositionProcedure =
      '/publira.v1.EpisodeReadService/SaveReadingPosition';
  static const _recentSeriesProcedure =
      '/publira.v1.EpisodeReadService/ListMyRecentSeries';
  static const _myEpisodeRatingProcedure =
      '/publira.v1.RatingService/GetMyEpisodeRating';
  static const _rateEpisodeProcedure = '/publira.v1.RatingService/RateEpisode';

  final AppConfig config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  /// How many series one catalog page holds, which is also the API's own
  /// fallback for a request naming no limit.
  static const seriesPageLimit = 20;

  @override
  Future<SeriesPage> listSeries({String token = ''}) => _listPublishedSeries(
    seriesPageLimit,
    'SERIES_ORDER_TITLE_ASC',
    token: token,
  );

  /// How many results one page of every search holds, which is also the API's
  /// own fallback for a request naming no limit.
  static const searchPageLimit = 20;

  @override
  Future<SeriesPage> searchSeries({
    required String query,
    String token = '',
  }) async {
    try {
      final body = await _search(_searchProcedure, query, token);
      return SeriesPage(
        series: _parseSeriesList(body['series']),
        nextToken: _readString(body, 'nextToken', 'response'),
      );
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
      final body = await _search(_searchCreatorsProcedure, query, token);
      final raw = body['creators'];
      return CreatorPage(
        // protojson omits an empty repeated field, which is how a keyword
        // nothing matches arrives.
        creators: raw == null
            ? const []
            : _expectList(raw, 'creators')
                  .map((item) => _publishedCreatorFromJson(item, 'creators[]'))
                  .toList(growable: false),
        nextToken: _readString(body, 'nextToken', 'response'),
      );
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
      final body = await _search(_searchLabelsProcedure, query, token);
      final raw = body['labels'];
      return LabelPage(
        labels: raw == null
            ? const []
            : _expectList(raw, 'labels')
                  .map(
                    (item) => _labelFromJson(item, 'labels[]', counted: false),
                  )
                  .toList(growable: false),
        nextToken: _readString(body, 'nextToken', 'response'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// One page of the search RPC [procedure] names, which every group of the
  /// search screen asks in the same shape.
  Future<Map<String, Object?>> _search(
    String procedure,
    String query,
    String token,
  ) async {
    final tenantId = await _tenants.resolve();
    return _client.unary(procedure, {
      'limit': searchPageLimit,
      'query': query,
      'surface': appClientSurface,
      if (token.isNotEmpty) 'token': token,
      'tenant': {'tenantId': tenantId},
    }, tenantId: tenantId);
  }

  @override
  Future<List<SeriesItem>> listNewestSeries({required int limit}) async {
    final page = await _listPublishedSeries(
      limit,
      'SERIES_ORDER_PUBLISHED_AT_DESC',
    );
    return page.series;
  }

  /// One page of `ListPublishedSeries`, in [order] as the enum names it.
  ///
  /// The order is always stated rather than left to the API's default, because
  /// the catalog screen shows two pages of this list at once — the newest few
  /// above the whole of it — and it is the orders that tell them apart.
  ///
  /// [token] is left off an empty request the way protojson leaves off a
  /// default, which is what asks for the first page.
  Future<SeriesPage> _listPublishedSeries(
    int limit,
    String order, {
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_listProcedure, {
        'limit': limit,
        'order': order,
        'surface': appClientSurface,
        if (token.isNotEmpty) 'token': token,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return SeriesPage(
        series: _parseSeriesList(body['series']),
        // protojson omits an empty string, which is how the last page arrives.
        nextToken: _readString(body, 'nextToken', 'response'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<List<RankedSeriesItem>> listRankedSeries({
    required int limit,
    required RankingPeriod period,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_rankedProcedure, {
        'limit': limit,
        'period': switch (period) {
          RankingPeriod.daily => 'RANKING_PERIOD_DAILY',
          RankingPeriod.weekly => 'RANKING_PERIOD_WEEKLY',
        },
        'surface': appClientSurface,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return _parseRankedSeries(body['rankedSeries']);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<RankedSeriesItem> _parseRankedSeries(Object? raw) {
    // protojson omits an empty repeated field, which is how a tenant the
    // ranking batch has not run for yet arrives.
    if (raw == null) {
      return const [];
    }
    final items = _expectList(raw, 'rankedSeries')
        .map((item) => _expectMap(item, 'rankedSeries[]'))
        .map((json) {
          return RankedSeriesItem(
            rank: _readInt(json, 'rank', 'rankedSeries[]'),
            series: _seriesFromJson(
              _expectMap(json['series'], 'rankedSeries[].series'),
              'rankedSeries[].series',
            ),
          );
        })
        .toList();
    return List<RankedSeriesItem>.unmodifiable(items);
  }

  @override
  Future<SeriesDetail?> getSeries(String publicId) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_detailProcedure, {
        'publicId': publicId,
        'surface': appClientSurface,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return _parseSeriesDetail(body);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<String?> getSeriesTitle(String publicId) async =>
      (await getSeries(publicId))?.series.title;

  @override
  Future<SeriesCreator?> getCreator(String publicId) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_creatorProcedure, {
        // The response carries a page of the creator's published series, which
        // a follow row does not show; one is asked for because the API falls
        // back to twenty.
        'limit': 1,
        'publicId': publicId,
        'surface': appClientSurface,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      final creator = _expectMap(body['creator'], 'creator');
      return SeriesCreator(
        id: _readString(creator, 'publicId', 'creator'),
        name: _readString(creator, 'name', 'creator'),
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
    String token = '',
  }) async {
    try {
      final body = await _detailPage(_creatorProcedure, publicId, token);
      return CreatorDetail(
        creator: _publishedCreatorFromJson(body['creator'], 'creator'),
        series: SeriesPage(
          series: _parseSeriesList(body['series']),
          nextToken: _readString(body, 'nextToken', 'response'),
        ),
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
    String token = '',
  }) async {
    try {
      final body = await _detailPage(_labelProcedure, publicId, token);
      return LabelDetail(
        label: _labelFromJson(body['label'], 'label', counted: true),
        series: SeriesPage(
          series: _parseSeriesList(body['series']),
          nextToken: _readString(body, 'nextToken', 'response'),
        ),
      );
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  /// One page of the detail RPC [procedure] names, which the author and the
  /// label ask in the same shape.
  Future<Map<String, Object?>> _detailPage(
    String procedure,
    String publicId,
    String token,
  ) async {
    final tenantId = await _tenants.resolve();
    return _client.unary(procedure, {
      'limit': detailSeriesPageLimit,
      'publicId': publicId,
      'surface': appClientSurface,
      if (token.isNotEmpty) 'token': token,
      'tenant': {'tenantId': tenantId},
    }, tenantId: tenantId);
  }

  PublishedCreator _publishedCreatorFromJson(Object? raw, String path) {
    final json = _expectMap(raw, path);
    final iconUrl = _readString(json, 'iconImageUrl', path);
    return PublishedCreator(
      id: _readString(json, 'publicId', path, requiredNonEmpty: true),
      name: _readString(json, 'name', path),
      profileText: _readString(json, 'profileText', path),
      // protojson omits an empty string, which is a creator with no portrait.
      iconUrl: iconUrl.isEmpty ? null : config.imageUri(iconUrl),
      imageRequestHeaders: config.publicImageRequestHeaders,
      seriesCount: _readCount(json, 'publishedSeriesCount', path),
    );
  }

  /// A `Label`, or with [counted] a `PublishedLabel`, which is the same label
  /// with the count of its published series.
  PublishedLabel _labelFromJson(
    Object? raw,
    String path, {
    required bool counted,
  }) {
    final json = _expectMap(raw, path);
    return PublishedLabel(
      id: _readString(json, 'publicId', path, requiredNonEmpty: true),
      name: _readString(json, 'name', path),
      eyeCatchVariants: _parseEyeCatchVariants(
        json['eyeCatchImageVariants'],
        path,
      ),
      imageRequestHeaders: config.publicImageRequestHeaders,
      seriesCount: counted
          ? _readCount(json, 'publishedSeriesCount', path)
          : null,
    );
  }

  @override
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    // Read before the first await, as the reads of the reader's own history
    // are: what a body grants belongs to the session that asked for it, and
    // the caller files it under the reader it read at this same instant.
    final accessToken = _client.accessToken;
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _episodeProcedure,
        {
          'publicId': episodePublicId,
          'surface': appClientSurface,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
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
    String episodePublicId,
  ) async {
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
      final body = await _client.unary(
        _readingPositionProcedure,
        {
          'episodePublicId': episodePublicId,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      final raw = body['position'];
      // protojson omits an unset message, which is the answer for a reader who
      // never opened the episode and for one who may no longer read it.
      if (raw == null) {
        return null;
      }
      return _readInt(_expectMap(raw, 'position'), 'pageIndex', 'position');
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  ) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return;
    }
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(
        _saveReadingPositionProcedure,
        {
          'episodePublicId': episodePublicId,
          'pageIndex': pageIndex,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeReaction?> getEpisodeReaction(String episodePublicId) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return null;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _myEpisodeRatingProcedure,
        {
          'episodePublicId': episodePublicId,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return _reactionFromJson(body, 'reaction');
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeReaction> reactToEpisode(String episodePublicId) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const CatalogFailure(
        CatalogFailureKind.unexpected,
        message: 'episode reactions require a session',
      );
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _rateEpisodeProcedure,
        {
          'episodePublicId': episodePublicId,
          'presses': 1,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return _reactionFromJson(body, 'reaction');
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<RecentSeriesPage> listRecentSeries({
    required int limit,
    String token = '',
  }) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return RecentSeriesPage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _recentSeriesProcedure,
        {
          'limit': limit,
          'tenant': {'tenantId': tenantId},
          if (token.isNotEmpty) 'token': token,
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return RecentSeriesPage(
        series: _parseRecentSeries(body['series']),
        nextToken: _readString(body, 'nextToken', 'response'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<RecentSeriesItem> _parseRecentSeries(Object? raw) {
    if (raw == null) {
      return const [];
    }
    final items = _expectList(raw, 'series')
        .map((item) => _expectMap(item, 'series[]'))
        .map((json) {
          return RecentSeriesItem(
            series: _seriesFromJson(
              _expectMap(json['series'], 'series[].series'),
              'series[].series',
            ),
            episode: _episodeFromJson(
              _expectMap(json['episode'], 'series[].episode'),
              'series[].episode',
            ),
          );
        })
        .toList();
    return List<RecentSeriesItem>.unmodifiable(items);
  }

  CatalogFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return CatalogFailure(CatalogFailureKind.network, message: error.message);
    }
    return CatalogFailure(
      CatalogFailureKind.unexpected,
      message: error.message,
    );
  }

  List<SeriesItem> _parseSeriesList(Object? raw) {
    // protojson omits an empty repeated field, so a missing `series` is the
    // valid wire representation of an empty catalog.
    if (raw == null) {
      return const [];
    }
    final series = _expectList(raw, 'series');
    return series
        .map((item) => _expectMap(item, 'series[]'))
        .map((item) => _seriesFromJson(item, 'series[]'))
        .toList(growable: false);
  }

  SeriesDetail _parseSeriesDetail(Map<String, Object?> body) {
    final rawSeries = _expectMap(body['series'], 'series');
    final series = _seriesFromJson(rawSeries, 'series');
    final episodes = _parseEpisodes(body['episodes']);
    return SeriesDetail(
      series: series.copyWith(episodeCount: episodes.length),
      episodes: episodes,
    );
  }

  SeriesItem _seriesFromJson(Map<String, Object?> json, String path) {
    final rawLabel = json['label'];
    final label = rawLabel == null ? null : _expectMap(rawLabel, '$path.label');
    return SeriesItem(
      id: _readString(json, 'publicId', path, requiredNonEmpty: true),
      title: _readString(json, 'title', path),
      description: _readString(json, 'synopsis', path),
      labelId: label == null
          ? ''
          : _readString(label, 'publicId', '$path.label'),
      labelName: label == null ? '' : _readString(label, 'name', '$path.label'),
      creators: _parseCreators(json['creators'], path),
      eyeCatchVariants: _parseEyeCatchVariants(
        json['eyeCatchImageVariants'],
        path,
      ),
      imageRequestHeaders: config.publicImageRequestHeaders,
      status: _parseStatus(json['status']),
      scheduleWeekdays: _parseScheduleWeekdays(json['scheduleWeekdays'], path),
      ageRating: _parseAgeRating(json['ageRating']),
      genres: _parseGenres(json['genres'], path),
      ratingAverage: _readDouble(json, 'ratingAverage', path),
      ratingCount: _readCount(json, 'ratingCount', path),
    );
  }

  /// protojson writes an enum as its name and omits the zero value, which is
  /// how an unclassified series arrives.
  SeriesStatus? _parseStatus(Object? raw) {
    return switch (raw) {
      'SERIES_STATUS_ONGOING' => SeriesStatus.ongoing,
      'SERIES_STATUS_COMPLETED' => SeriesStatus.completed,
      'SERIES_STATUS_HIATUS' => SeriesStatus.hiatus,
      _ => null,
    };
  }

  /// protojson writes an enum as its name and omits the zero value. A name
  /// this build does not know is [SeriesAgeRating.unknown], so a future
  /// rating cannot open as unrestricted.
  SeriesAgeRating? _parseAgeRating(Object? raw) {
    return switch (raw) {
      null || 0 || 'SERIES_AGE_RATING_UNSPECIFIED' => null,
      'SERIES_AGE_RATING_ALL' => SeriesAgeRating.all,
      'SERIES_AGE_RATING_R15' => SeriesAgeRating.r15,
      'SERIES_AGE_RATING_R18' => SeriesAgeRating.r18,
      _ => SeriesAgeRating.unknown,
    };
  }

  List<int> _parseScheduleWeekdays(Object? raw, String path) {
    // protojson omits an empty repeated field, which is a series that keeps
    // no weekly schedule.
    if (raw == null) {
      return const [];
    }
    final weekdays = _expectList(raw, '$path.scheduleWeekdays')
        .map((item) {
          if (item is! int) {
            _invalidPayload('$path.scheduleWeekdays[] must be an integer');
          }
          return item;
        })
        // A number outside Sunday–Saturday is dropped rather than named: the
        // weekday formatter would write it out as the digit it is.
        .where((weekday) => weekday >= 0 && weekday <= 6)
        .toList();
    return List<int>.unmodifiable(weekdays);
  }

  List<SeriesGenre> _parseGenres(Object? raw, String path) {
    // protojson omits an empty repeated field, so a series in no genre
    // arrives without the key at all.
    if (raw == null) {
      return const [];
    }
    final genrePath = '$path.genres[]';
    final genres = _expectList(raw, '$path.genres')
        .map((item) => _expectMap(item, genrePath))
        .map((json) {
          return SeriesGenre(
            id: _readString(json, 'publicId', genrePath),
            name: _readString(json, 'name', genrePath),
          );
        })
        // A genre with no name or no public id is nothing a reader can be
        // shown, and the site drops it from the same field for the same
        // reason.
        .where((genre) => genre.id.isNotEmpty && genre.name.isNotEmpty)
        .toList();
    return List<SeriesGenre>.unmodifiable(genres);
  }

  List<SeriesCreator> _parseCreators(Object? raw, String path) {
    // protojson omits an empty repeated field, so a series credited to nobody
    // arrives without the key at all.
    if (raw == null) {
      return const [];
    }
    final creatorPath = '$path.creators[]';
    final creators = _expectList(raw, '$path.creators')
        .map((item) => _expectMap(item, creatorPath))
        .map((json) {
          final rawRole = json['role'];
          return SeriesCreator(
            id: _readString(json, 'publicId', creatorPath),
            name: _readString(json, 'name', creatorPath),
            // protojson omits an unset message, which is a credit written
            // before the tenant curated any role.
            roleName: rawRole == null
                ? ''
                : _readString(
                    _expectMap(rawRole, '$creatorPath.role'),
                    'name',
                    '$creatorPath.role',
                  ).trim(),
          );
        })
        // A nameless credit is nothing a reader can be shown, and the site
        // drops it from the same field for the same reason.
        .where((creator) => creator.name.isNotEmpty)
        .toList();
    return List<SeriesCreator>.unmodifiable(creators);
  }

  List<EyeCatchVariant> _parseEyeCatchVariants(Object? raw, String path) {
    // protojson omits an empty repeated field, so a series with no cover
    // arrives without the key at all.
    if (raw == null) {
      return const [];
    }
    final variantPath = '$path.eyeCatchImageVariants[]';
    final variants = _expectList(raw, '$path.eyeCatchImageVariants')
        .map((item) => _expectMap(item, variantPath))
        .map((json) {
          return EyeCatchVariant(
            variantType: _readString(json, 'variantType', variantPath),
            url: config.imageUri(
              _readString(json, 'url', variantPath, requiredNonEmpty: true),
            ),
            width: _readInt(json, 'width', variantPath),
            height: _readInt(json, 'height', variantPath),
          );
        })
        .toList();
    return List<EyeCatchVariant>.unmodifiable(variants);
  }

  List<EpisodeItem> _parseEpisodes(Object? raw) {
    if (raw == null) {
      return const [];
    }
    final episodes = _expectList(raw, 'episodes')
        .map((item) => _expectMap(item, 'episodes[]'))
        .map((json) => _episodeFromJson(json, 'episodes[]'))
        .toList();
    episodes.sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return List<EpisodeItem>.unmodifiable(episodes);
  }

  EpisodeItem _episodeFromJson(Map<String, Object?> json, String path) {
    return EpisodeItem(
      id: _readString(json, 'publicId', path, requiredNonEmpty: true),
      title: _readString(json, 'title', path),
      orderIndex: _readInt(json, 'orderIndex', path),
      price: _readInt(json, 'price', path),
      ratingCount: _readCount(json, 'ratingCount', path),
    );
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
    Map<String, Object?> body,
    String seriesPublicId,
    String accessToken,
  ) {
    final rawSeries = _expectMap(body['series'], 'series');
    final seriesId = _readString(
      rawSeries,
      'publicId',
      'series',
      requiredNonEmpty: true,
    );
    if (seriesId != seriesPublicId) {
      return null;
    }
    final rawEpisode = _expectMap(body['episode'], 'episode');
    return EpisodeDetail(
      episode: _episodeFromJson(rawEpisode, 'episode'),
      seriesId: seriesId,
      seriesTitle: _readString(rawSeries, 'title', 'series'),
      access: EpisodeAccess.fromWire(body['access']),
      images: _parseEpisodeImages(body['images']),
      previousEpisode: _neighborFromJson(
        body['previousEpisode'],
        'previousEpisode',
      ),
      nextEpisode: _neighborFromJson(body['nextEpisode'], 'nextEpisode'),
      imageRequestHeaders: config.imageRequestHeaders(accessToken),
      ageRating: _parseAgeRating(rawSeries['ageRating']),
      creators: _parseCreators(rawEpisode['creators'], 'episode'),
      readingDirection: _parseReadingDirection(rawEpisode['readingDirection']),
      // protojson omits a zero, which is pairing from the first page. A
      // never-edited series answers 1, so the field is present then.
      spreadStartIndex: _readCount(rawEpisode, 'spreadStartIndex', 'episode'),
    );
  }

  /// One side of the episode, or `null` at that end of the series.
  ///
  /// protojson omits an unset message, which is what the server sends where
  /// there is no episode on that side. A neighbour that names no episode is
  /// read the same way: nothing can be opened from it.
  EpisodeNeighbor? _neighborFromJson(Object? raw, String path) {
    if (raw == null) {
      return null;
    }
    final json = _expectMap(raw, path);
    final id = _readString(json, 'publicId', path);
    if (id.isEmpty) {
      return null;
    }
    return EpisodeNeighbor(
      id: id,
      title: _readString(json, 'title', path),
      orderIndex: _readInt(json, 'orderIndex', path),
      price: _readInt(json, 'price', path),
      isFree: _readBool(json, 'isFree', path),
    );
  }

  EpisodeReaction _reactionFromJson(Map<String, Object?> json, String path) {
    final rawScore = _readInt(json, 'score', path);
    return EpisodeReaction(
      score: rawScore < 0 ? 0 : (rawScore > 5 ? 5 : rawScore),
      ratingCount: _readCount(json, 'ratingCount', path),
      allowsMultiplePresses: json['mode'] == 'EPISODE_RATING_MODE_MULTIPLE',
    );
  }

  /// protojson writes an enum as its name and omits the zero value, which is
  /// unspecified and is read as right-to-left, the way a series nobody has
  /// set is laid out. A name this build does not know is read the same way
  /// rather than flipping the work.
  ReadingDirection _parseReadingDirection(Object? raw) {
    return switch (raw) {
      'READING_DIRECTION_LEFT_TO_RIGHT' => ReadingDirection.ltr,
      _ => ReadingDirection.rtl,
    };
  }

  List<EpisodeImageItem> _parseEpisodeImages(Object? raw) {
    if (raw == null) {
      return const [];
    }
    final images = _expectList(raw, 'images')
        .map((item) => _expectMap(item, 'images[]'))
        .map((json) {
          return EpisodeImageItem(
            id: _readString(json, 'id', 'images[]', requiredNonEmpty: true),
            url: config.imageUri(
              _readString(json, 'imageUrl', 'images[]', requiredNonEmpty: true),
            ),
            displayOrder: _readInt(json, 'displayOrder', 'images[]'),
            width: _readInt(json, 'width', 'images[]'),
            height: _readInt(json, 'height', 'images[]'),
          );
        })
        .toList();
    images.sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
    return List<EpisodeImageItem>.unmodifiable(images);
  }

  List<Object?> _expectList(Object? value, String path) {
    if (value is List) {
      return value;
    }
    _invalidPayload('$path must be a list');
  }

  Map<String, Object?> _expectMap(Object? value, String path) {
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    _invalidPayload('$path must be an object');
  }

  String _readString(
    Map<String, Object?> json,
    String key,
    String path, {
    bool requiredNonEmpty = false,
  }) {
    final value = json[key];
    if (value == null && !requiredNonEmpty) {
      return '';
    }
    if (value is! String || (requiredNonEmpty && value.trim().isEmpty)) {
      final expected = requiredNonEmpty ? 'a non-empty string' : 'a string';
      _invalidPayload('$path.$key must be $expected');
    }
    return value.trim();
  }

  int _readInt(Map<String, Object?> json, String key, String path) {
    final value = json[key];
    if (value == null) {
      return 0;
    }
    if (value is int) {
      return value;
    }
    _invalidPayload('$path.$key must be an integer');
  }

  int _readCount(Map<String, Object?> json, String key, String path) {
    final value = json[key];
    if (value == null) {
      return 0;
    }
    final parsed = switch (value) {
      int value => value,
      String value => int.tryParse(value),
      _ => null,
    };
    if (parsed == null || parsed < 0) {
      _invalidPayload('$path.$key must be a non-negative integer');
    }
    return parsed;
  }

  double _readDouble(Map<String, Object?> json, String key, String path) {
    final value = json[key];
    if (value == null) {
      return 0;
    }
    if (value is num && value.isFinite && value >= 0 && value <= 5) {
      return value.toDouble();
    }
    _invalidPayload('$path.$key must be a number between 0 and 5');
  }

  bool _readBool(Map<String, Object?> json, String key, String path) {
    final value = json[key];
    // protojson omits a false, which is what a paid neighbour arrives as.
    if (value == null) {
      return false;
    }
    if (value is bool) {
      return value;
    }
    _invalidPayload('$path.$key must be a boolean');
  }

  Never _invalidPayload(String message) {
    throw CatalogFailure(CatalogFailureKind.unexpected, message: message);
  }
}
