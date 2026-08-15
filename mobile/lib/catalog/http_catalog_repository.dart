import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/series_item.dart';

/// [CatalogRepository] backed by the public Connect API.
class HttpCatalogRepository implements CatalogRepository {
  HttpCatalogRepository({required this.config, ConnectClient? client})
    : _client = client ?? ConnectClient(baseUrl: config.apiBaseUrl);

  static const _listProcedure =
      '/publira.v1.CatalogService/ListPublishedSeries';
  static const _detailProcedure = '/publira.v1.CatalogService/GetSeriesDetail';
  static const _tenantProcedure = '/publira.v1.DomainService/GetTenantByDomain';

  final AppConfig config;
  final ConnectClient _client;

  String? _tenantId;
  Future<String>? _tenantIdFuture;

  @override
  Future<List<SeriesItem>> listSeries() async {
    try {
      final tenantId = await _resolveTenantId();
      final body = await _client.unary(_listProcedure, {
        'limit': 20,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return _parseSeriesList(body['series']);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<SeriesDetail?> getSeries(String publicId) async {
    try {
      final tenantId = await _resolveTenantId();
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

  Future<String> _resolveTenantId() {
    final cached = _tenantId;
    if (cached != null) {
      return Future.value(cached);
    }
    return _tenantIdFuture ??= _fetchTenantId();
  }

  Future<String> _fetchTenantId() async {
    try {
      final body = await _client.unary(_tenantProcedure, {
        'domains': [config.tenantHost],
      });
      final tenantId = (body['tenantId'] as String?)?.trim() ?? '';
      if (tenantId.isEmpty) {
        throw const CatalogFailure(
          CatalogFailureKind.unexpected,
          message: 'GetTenantByDomain returned an empty tenantId',
        );
      }
      _tenantId = tenantId;
      return tenantId;
    } on ConnectException catch (error) {
      _tenantIdFuture = null;
      throw _toFailure(error);
    } catch (error) {
      _tenantIdFuture = null;
      rethrow;
    }
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
      series: SeriesItem(
        id: series.id,
        title: series.title,
        description: series.description,
        episodeCount: episodes.length,
        labelName: series.labelName,
      ),
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
    );
  }

  List<EpisodeItem> _parseEpisodes(Object? raw) {
    if (raw == null) {
      return const [];
    }
    final episodes = _expectList(raw, 'episodes')
        .map((item) => _expectMap(item, 'episodes[]'))
        .map((json) {
          return EpisodeItem(
            id: _readString(
              json,
              'publicId',
              'episodes[]',
              requiredNonEmpty: true,
            ),
            title: _readString(json, 'title', 'episodes[]'),
            orderIndex: _readInt(json, 'orderIndex', 'episodes[]'),
            price: _readInt(json, 'price', 'episodes[]'),
          );
        })
        .toList();
    episodes.sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return List<EpisodeItem>.unmodifiable(episodes);
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

  Never _invalidPayload(String message) {
    throw CatalogFailure(CatalogFailureKind.unexpected, message: message);
  }
}
