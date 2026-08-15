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
    if (raw is! List) {
      return const [];
    }
    return raw
        .map(_asStringKeyedMap)
        .whereType<Map<String, Object?>>()
        .map(_seriesFromJson)
        .where((item) => item.id.isNotEmpty)
        .toList(growable: false);
  }

  SeriesDetail? _parseSeriesDetail(Map<String, Object?> body) {
    final rawSeries = _asStringKeyedMap(body['series']);
    if (rawSeries == null) {
      return null;
    }
    final series = _seriesFromJson(rawSeries);
    if (series.id.isEmpty) {
      return null;
    }
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

  SeriesItem _seriesFromJson(Map<String, Object?> json) {
    final label = _asStringKeyedMap(json['label']);
    final labelName = (label?['name'] as String?) ?? '';
    return SeriesItem(
      id: (json['publicId'] as String? ?? '').trim(),
      title: (json['title'] as String? ?? '').trim(),
      description: (json['synopsis'] as String? ?? '').trim(),
      labelName: labelName.trim(),
    );
  }

  List<EpisodeItem> _parseEpisodes(Object? raw) {
    if (raw is! List) {
      return const [];
    }
    final episodes = raw
        .map(_asStringKeyedMap)
        .whereType<Map<String, Object?>>()
        .map((json) {
          return EpisodeItem(
            id: (json['publicId'] as String? ?? '').trim(),
            title: (json['title'] as String? ?? '').trim(),
            orderIndex: _asInt(json['orderIndex']),
            price: _asInt(json['price']),
          );
        })
        .where((item) => item.id.isNotEmpty)
        .toList();
    episodes.sort((a, b) => a.orderIndex.compareTo(b.orderIndex));
    return List<EpisodeItem>.unmodifiable(episodes);
  }

  Map<String, Object?>? _asStringKeyedMap(Object? value) {
    if (value is Map<String, Object?>) {
      return value;
    }
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    return null;
  }

  int _asInt(Object? value) {
    if (value is int) {
      return value;
    }
    if (value is num) {
      return value.toInt();
    }
    return 0;
  }
}
