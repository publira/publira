import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// [PurchaseRepository] backed by `publira.v1.PurchaseService` and the reads
/// of `TenantService` and `CatalogService` a purchase is offered from.
class HttpPurchaseRepository implements PurchaseRepository {
  const HttpPurchaseRepository({required this._client, required this._tenants});

  static const _tenantProcedure = '/publira.v1.TenantService/GetTenant';
  static const _accessProcedure =
      '/publira.v1.CatalogService/GetSeriesEpisodeAccess';
  static const _episodeProcedure =
      '/publira.v1.CatalogService/GetEpisodeDetail';
  static const _checkoutProcedure =
      '/publira.v1.PurchaseService/StartEpisodeCheckout';
  static const _listProcedure = '/publira.v1.PurchaseService/ListMyPurchases';

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<bool> acceptsPayments() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_tenantProcedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      // protojson omits a false.
      return body['acceptsPayments'] == true;
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<Map<String, EpisodeAccess>> seriesEpisodeAccess(
    String seriesPublicId,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_accessProcedure, {
        'seriesPublicId': seriesPublicId,
        'surface': appClientSurface,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      final raw = body['episodes'];
      // protojson omits an empty repeated field.
      if (raw == null) {
        return const {};
      }
      if (raw is! List) {
        throw const PurchaseFailure(
          PurchaseFailureKind.unexpected,
          message: 'episodes must be a list',
        );
      }
      return Map.unmodifiable({
        for (final item in raw)
          if (item is Map && item['episodePublicId'] is String)
            item['episodePublicId'] as String: EpisodeAccess.fromWire(
              item['access'],
            ),
      });
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<String?> seriesOfEpisode(String episodePublicId) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_episodeProcedure, {
        'publicId': episodePublicId,
        'surface': appClientSurface,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      final series = body['series'];
      final id = series is Map ? series['publicId'] : null;
      if (id is! String || id.isEmpty) {
        throw const PurchaseFailure(
          PurchaseFailureKind.unexpected,
          message: 'series.publicId is missing',
        );
      }
      return id;
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        return null;
      }
      throw _toFailure(error);
    }
  }

  @override
  Future<Uri> startEpisodeCheckout(String episodePublicId) async {
    // The token is read here and sent explicitly, so a checkout is never
    // started for a reader other than the one who tapped.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _checkoutProcedure,
        {
          'client': 'CLIENT_MOBILE',
          'episodePublicId': episodePublicId,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      final raw = body['checkoutUrl'];
      final url = raw is String ? Uri.tryParse(raw.trim()) : null;
      if (url == null || url.scheme != 'https') {
        throw const PurchaseFailure(
          PurchaseFailureKind.unexpected,
          message: 'checkoutUrl is not an https URL',
        );
      }
      return url;
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<MyPurchasePage> listMyPurchases({String token = ''}) async {
    // Read once and sent explicitly, so a page is never answered for a reader
    // other than the one the list was opened for.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return MyPurchasePage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _listProcedure,
        {
          'limit': pageSize,
          'surface': appClientSurface,
          'tenant': {'tenantId': tenantId},
          if (token.isNotEmpty) 'token': token,
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return MyPurchasePage(
        purchases: _purchases(body['purchases']),
        nextToken: _readString(body, 'nextToken'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<MyPurchase> _purchases(Object? raw) {
    // protojson omits an empty repeated field.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'purchases must be a list',
      );
    }
    return List.unmodifiable(
      raw
          .map(
            (item) => item is Map
                ? _purchase(item.cast<String, Object?>())
                : throw const PurchaseFailure(
                    PurchaseFailureKind.unexpected,
                    message: 'purchases[] must be an object',
                  ),
          )
          // A row naming no episode to open is a row no screen could render.
          .nonNulls,
    );
  }

  MyPurchase? _purchase(Map<String, Object?> json) {
    final episode = _map(json['episode']);
    final series = _map(json['series']);
    final episodeId = _readString(episode, 'publicId');
    final seriesId = _readString(series, 'publicId');
    if (episodeId.isEmpty || seriesId.isEmpty) {
      return null;
    }
    return MyPurchase(
      id: _readString(json, 'id'),
      seriesId: seriesId,
      seriesTitle: _readString(series, 'title'),
      episodeId: episodeId,
      episodeTitle: _readString(episode, 'title'),
      orderIndex: _readInt(episode, 'orderIndex'),
      price: _readInt(json, 'priceAtPurchase'),
      // protojson omits a false, which is what every expired row arrives as.
      isActive: json['isActive'] == true,
      purchasedAt: _readInstant(json, 'purchasedAt'),
      expiresAt: _readInstant(json, 'expiresAt'),
    );
  }

  Map<String, Object?> _map(Object? value) =>
      value is Map ? value.cast<String, Object?>() : const {};

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }

  /// protojson writes an `int32` as a number and omits a zero.
  int _readInt(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is num ? value.toInt() : 0;
  }

  DateTime? _readInstant(Map<String, Object?> json, String key) =>
      DateTime.tryParse(_readString(json, key))?.toLocal();

  PurchaseFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return PurchaseFailure(
        PurchaseFailureKind.network,
        message: error.message,
      );
    }
    return switch (error.code) {
      'unauthenticated' => PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
        message: error.message,
      ),
      'already_exists' => PurchaseFailure(
        PurchaseFailureKind.alreadyPurchased,
        message: error.message,
      ),
      'not_found' || 'permission_denied' => PurchaseFailure(
        PurchaseFailureKind.gone,
        message: error.message,
      ),
      _ => PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: error.message,
      ),
    };
  }
}
