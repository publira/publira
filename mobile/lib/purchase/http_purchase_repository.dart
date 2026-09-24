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
  const HttpPurchaseRepository({
    required this._client,
    required this._tenants,
    this.store,
  });

  static const _tenantProcedure = '/publira.v1.TenantService/GetTenant';
  static const _accessProcedure =
      '/publira.v1.CatalogService/GetSeriesEpisodeAccess';
  static const _episodeProcedure =
      '/publira.v1.CatalogService/GetEpisodeDetail';
  static const _checkoutProcedure =
      '/publira.v1.PurchaseService/StartEpisodeCheckout';
  static const _listProcedure = '/publira.v1.PurchaseService/ListMyPurchases';
  static const _startStoreProcedure =
      '/publira.v1.PurchaseService/StartStorePurchase';
  static const _confirmStoreProcedure =
      '/publira.v1.PurchaseService/ConfirmStorePurchase';

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  /// The store this device buys through, or `null` where there is none.
  final InAppPurchaseStore? store;

  @override
  Future<bool> acceptsPayments() async {
    final tenant = await _tenant();
    // protojson omits a false.
    return switch (_route(tenant)) {
      AppPurchaseRoute.externalCheckout => tenant['acceptsPayments'] == true,
      AppPurchaseRoute.store => switch (store) {
        InAppPurchaseStore.appStore =>
          tenant['acceptsAppStorePayments'] == true,
        InAppPurchaseStore.googlePlay =>
          tenant['acceptsGooglePlayPayments'] == true,
        null => false,
      },
    };
  }

  @override
  Future<AppPurchaseRoute> appPurchaseRoute() async => _route(await _tenant());

  Future<Map<String, Object?>> _tenant() async {
    try {
      final tenantId = await _tenants.resolve();
      return await _client.unary(_tenantProcedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// A server that names no route predates the store route, and sells through
  /// the external checkout like every tenant that has chosen nothing.
  AppPurchaseRoute _route(Map<String, Object?> tenant) =>
      tenant['appPurchaseRoute'] == 'APP_PURCHASE_ROUTE_STORE'
      ? AppPurchaseRoute.store
      : AppPurchaseRoute.externalCheckout;

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
  Future<StorePurchaseIntent> startStorePurchase(
    String episodePublicId,
    InAppPurchaseStore store,
  ) async {
    // Read once and sent explicitly, so the intent is opened for the reader
    // who tapped and no one else.
    final accessToken = _requireAccessToken();
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _startStoreProcedure,
        {
          'episodePublicId': episodePublicId,
          'store': store.wireName,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      final intentId = _readString(body, 'intentId');
      final productId = _readString(body, 'productId');
      if (intentId.isEmpty || productId.isEmpty) {
        throw const PurchaseFailure(
          PurchaseFailureKind.unexpected,
          message: 'intentId and productId are required',
        );
      }
      return StorePurchaseIntent(intentId: intentId, productId: productId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> confirmStorePurchase({
    required InAppPurchaseStore store,
    required String transaction,
    required String productId,
  }) async {
    final accessToken = _requireAccessToken();
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(
        _confirmStoreProcedure,
        {
          'productId': productId,
          'store': store.wireName,
          'tenant': {'tenantId': tenantId},
          'transaction': transaction,
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
    } on ConnectException catch (error) {
      // Here the store has not settled the charge, rather than the tenant
      // not selling the episode.
      if (error.code == 'failed_precondition') {
        throw PurchaseFailure(
          PurchaseFailureKind.notSettled,
          message: error.message,
        );
      }
      throw _toFailure(error);
    }
  }

  String _requireAccessToken() {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const PurchaseFailure(
        PurchaseFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    return accessToken;
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
      'failed_precondition' => PurchaseFailure(
        PurchaseFailureKind.notSold,
        message: error.message,
      ),
      _ => PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: error.message,
      ),
    };
  }
}
