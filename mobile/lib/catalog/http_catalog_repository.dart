import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';

/// [CatalogRepository] backed by the public Connect API.
class HttpCatalogRepository implements CatalogRepository {
  factory HttpCatalogRepository({
    required AppConfig config,
    ConnectClient? client,
    TenantResolver? tenants,
  }) {
    final resolved = client ?? ConnectClient(baseUrl: config.apiBaseUrl);
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
    required ConnectClient client,
    required TenantResolver tenants,
  }) : _client = client,
       _tenants = tenants;

  static const _listProcedure =
      '/publira.v1.CatalogService/ListPublishedSeries';
  static const _rankedProcedure = '/publira.v1.CatalogService/ListRankedSeries';
  static const _detailProcedure = '/publira.v1.CatalogService/GetSeriesDetail';
  static const _episodeProcedure =
      '/publira.v1.CatalogService/GetEpisodeDetail';
  static const _readingPositionProcedure =
      '/publira.v1.EpisodeReadService/GetMyReadingPosition';
  static const _saveReadingPositionProcedure =
      '/publira.v1.EpisodeReadService/SaveReadingPosition';
  static const _recentSeriesProcedure =
      '/publira.v1.EpisodeReadService/ListMyRecentSeries';

  final AppConfig config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  /// How many series one catalog page holds, which is also the API's own
  /// fallback for a request naming no limit.
  static const seriesPageLimit = 20;

  @override
  Future<List<SeriesItem>> listSeries() =>
      _listPublishedSeries(seriesPageLimit, 'SERIES_ORDER_TITLE_ASC');

  @override
  Future<List<SeriesItem>> listNewestSeries({required int limit}) =>
      _listPublishedSeries(limit, 'SERIES_ORDER_PUBLISHED_AT_DESC');

  /// One page of `ListPublishedSeries`, in [order] as the enum names it.
  ///
  /// The order is always stated rather than left to the API's default, because
  /// the catalog screen shows two pages of this list at once — the newest few
  /// above the whole of it — and it is the orders that tell them apart.
  Future<List<SeriesItem>> _listPublishedSeries(int limit, String order) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_listProcedure, {
        'limit': limit,
        'order': order,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return _parseSeriesList(body['series']);
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
  Future<EpisodeDetail?> getEpisode(
    String seriesPublicId,
    String episodePublicId,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_episodeProcedure, {
        'publicId': episodePublicId,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return _parseEpisodeDetail(body, seriesPublicId);
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
  Future<List<RecentSeriesItem>> listRecentSeries({required int limit}) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return const [];
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _recentSeriesProcedure,
        {
          'limit': limit,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return _parseRecentSeries(body['series']);
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
    final labelName = rawLabel == null
        ? ''
        : _readString(
            _expectMap(rawLabel, '$path.label'),
            'name',
            '$path.label',
          );
    return SeriesItem(
      id: _readString(json, 'publicId', path, requiredNonEmpty: true),
      title: _readString(json, 'title', path),
      description: _readString(json, 'synopsis', path),
      labelName: labelName.trim(),
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

  /// protojson writes an enum as its name. Unspecified and a name this build
  /// does not know are both read as unset, so a new rating cannot close a
  /// series a tenant never rated.
  SeriesAgeRating? _parseAgeRating(Object? raw) {
    return switch (raw) {
      'SERIES_AGE_RATING_ALL' => SeriesAgeRating.all,
      'SERIES_AGE_RATING_R15' => SeriesAgeRating.r15,
      'SERIES_AGE_RATING_R18' => SeriesAgeRating.r18,
      _ => null,
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
          return SeriesCreator(
            id: _readString(json, 'publicId', creatorPath),
            name: _readString(json, 'name', creatorPath),
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
    );
  }

  /// Builds the reader's view of one episode.
  ///
  /// The series is checked here rather than trusted from the route: an episode
  /// public id addresses the episode alone, so a mismatched pair would
  /// otherwise render one series' body under another series' URL.
  EpisodeDetail? _parseEpisodeDetail(
    Map<String, Object?> body,
    String seriesPublicId,
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
    return EpisodeDetail(
      episode: _episodeFromJson(
        _expectMap(body['episode'], 'episode'),
        'episode',
      ),
      seriesId: seriesId,
      seriesTitle: _readString(rawSeries, 'title', 'series'),
      access: _parseAccess(body['access']),
      images: _parseEpisodeImages(body['images']),
      previousEpisode: _neighborFromJson(
        body['previousEpisode'],
        'previousEpisode',
      ),
      nextEpisode: _neighborFromJson(body['nextEpisode'], 'nextEpisode'),
      imageRequestHeaders: config.imageRequestHeaders(_client.accessToken),
      ageRating: _parseAgeRating(rawSeries['ageRating']),
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

  EpisodeAccess _parseAccess(Object? raw) {
    // protojson writes an enum as its name, and omits it entirely when it is
    // the zero value.
    return switch (raw) {
      'EPISODE_ACCESS_FREE' => EpisodeAccess.free,
      'EPISODE_ACCESS_LOCKED' => EpisodeAccess.locked,
      'EPISODE_ACCESS_ENTITLED' => EpisodeAccess.entitled,
      _ => EpisodeAccess.unknown,
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
