import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
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

  final ConnectClient _client;
  final TenantResolver _tenants;

  /// The store this device buys through, or `null` where there is none.
  final InAppPurchaseStore? store;

  @override
  Future<bool> acceptsPayments() async {
    final tenant = await _tenant();
    return switch (_route(tenant)) {
      AppPurchaseRoute.externalCheckout => tenant.acceptsPayments,
      AppPurchaseRoute.store => switch (store) {
        InAppPurchaseStore.appStore => tenant.acceptsAppStorePayments,
        InAppPurchaseStore.googlePlay => tenant.acceptsGooglePlayPayments,
        null => false,
      },
    };
  }

  @override
  Future<AppPurchaseRoute> appPurchaseRoute() async => _route(await _tenant());

  @override
  Future<String> currency() async {
    final currency = (await _tenant()).currency;
    if (!_currencyPattern.hasMatch(currency)) {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'currency must be an ISO 4217 code',
      );
    }
    return currency;
  }

  /// An ISO 4217 code as the API spells it.
  static final _currencyPattern = RegExp(r'^[A-Z]{3}$');

  Future<pb.GetTenantResponse> _tenant() async {
    try {
      final tenantId = await _tenants.resolve();
      return await pb.TenantServiceApi(_client).getTenant(
        ConnectCallContext(tenantId: tenantId),
        pb.GetTenantRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// A server that names no route predates the store route, and sells through
  /// the external checkout like every tenant that has chosen nothing.
  AppPurchaseRoute _route(pb.GetTenantResponse tenant) =>
      tenant.appPurchaseRoute == pb.AppPurchaseRoute.APP_PURCHASE_ROUTE_STORE
      ? AppPurchaseRoute.store
      : AppPurchaseRoute.externalCheckout;

  @override
  Future<SeriesPurchaseState> seriesEpisodeAccess(
    String seriesInternalId,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      // A signed-in reader is answered for what they hold, and a guest for
      // what a reader holding nothing would be offered.
      final body = await pb.CatalogServiceApi(_client).getSeriesEpisodeAccess(
        ConnectCallContext(tenantId: tenantId),
        pb.GetSeriesEpisodeAccessRequest(
          seriesId: seriesInternalId,
          surface: appClientSurface,
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      final remainder = body.remainder;
      return SeriesPurchaseState(
        access: Map.unmodifiable({
          for (final item in body.episodes)
            // The wire format omits an empty string, so a row that names no
            // episode is one without the key.
            if (item.episodePublicId.isNotEmpty)
              item.episodePublicId: EpisodeAccess.fromWire(item.access),
        }),
        ownedEpisodeIds: Set.unmodifiable({
          for (final item in body.episodes)
            if (item.owned && item.episodeId.isNotEmpty) item.episodeId,
        }),
        // The wire format omits the unset message, which is how a series with
        // nothing left to sell arrives.
        remainder: body.hasRemainder() && remainder.episodeCount > 0
            ? SeriesRemainderOffer(
                episodeCount: remainder.episodeCount,
                listPrice: remainder.listPrice,
                discountPercent: remainder.discountPercent,
                price: remainder.price,
              )
            : null,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<String?> seriesOfEpisode(String episodePublicId) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CatalogServiceApi(_client).getEpisodeDetail(
        ConnectCallContext(tenantId: tenantId),
        pb.GetEpisodeDetailRequest(
          publicId: episodePublicId,
          surface: appClientSurface,
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      final id = body.series.publicId;
      if (id.isEmpty) {
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
  Future<Uri> startEpisodeCheckout(
    String episodeInternalId, {
    required String locale,
    PurchaseKind kind = PurchaseKind.purchase,
  }) async {
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
      final body = await pb.PurchaseServiceApi(_client).startEpisodeCheckout(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.StartEpisodeCheckoutRequest(
          client: pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE,
          episodeId: episodeInternalId,
          kind: switch (kind) {
            PurchaseKind.purchase => pb.PurchaseKind.PURCHASE_KIND_PURCHASE,
            PurchaseKind.rental => pb.PurchaseKind.PURCHASE_KIND_RENTAL,
          },
          locale: locale,
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      return _checkoutUrl(body.checkoutUrl);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<Uri> startVolumeCheckout(String volumeInternalId) async {
    // Read once and sent explicitly, so the checkout is started for the reader
    // who tapped and no one else.
    final accessToken = _requireAccessToken();
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.PurchaseServiceApi(_client).startVolumeCheckout(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.StartVolumeCheckoutRequest(
          client: pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE,
          tenant: pb.TenantContext(tenantId: tenantId),
          volumeId: volumeInternalId,
        ),
      );
      return _checkoutUrl(body.checkoutUrl);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<Uri> startSeriesRemainderCheckout(
    String seriesInternalId, {
    required String locale,
  }) async {
    final accessToken = _requireAccessToken();
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.PurchaseServiceApi(_client)
          .startSeriesRemainderCheckout(
            ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
            pb.StartSeriesRemainderCheckoutRequest(
              client: pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE,
              locale: locale,
              seriesId: seriesInternalId,
              tenant: pb.TenantContext(tenantId: tenantId),
            ),
          );
      return _checkoutUrl(body.checkoutUrl);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The page a checkout answered, which the system browser is handed, so
  /// nothing but an https URL is.
  static Uri _checkoutUrl(String raw) {
    final url = Uri.tryParse(raw.trim());
    if (url == null || url.scheme != 'https') {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'checkoutUrl is not an https URL',
      );
    }
    return url;
  }

  @override
  Future<StorePurchaseIntent> startStorePurchase(
    String episodeInternalId,
    InAppPurchaseStore store,
  ) async {
    // Read once and sent explicitly, so the intent is opened for the reader
    // who tapped and no one else.
    final accessToken = _requireAccessToken();
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.PurchaseServiceApi(_client).startStorePurchase(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.StartStorePurchaseRequest(
          episodeId: episodeInternalId,
          store: _store(store),
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      final intentId = body.intentId.trim();
      final productId = body.productId.trim();
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
      await pb.PurchaseServiceApi(_client).confirmStorePurchase(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ConfirmStorePurchaseRequest(
          productId: productId,
          store: _store(store),
          tenant: pb.TenantContext(tenantId: tenantId),
          transaction: transaction,
        ),
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

  static pb.InAppPurchaseStore _store(InAppPurchaseStore store) =>
      switch (store) {
        InAppPurchaseStore.appStore =>
          pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_APP_STORE,
        InAppPurchaseStore.googlePlay =>
          pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
      };

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
  Future<MyPurchasePage> listMyPurchases({
    required String locale,
    String token = '',
    int limit = myPurchasePageLimit,
  }) async {
    // Read once and sent explicitly, so a page is never answered for a reader
    // other than the one the list was opened for.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return MyPurchasePage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.PurchaseServiceApi(_client).listMyPurchases(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyPurchasesRequest(
          limit: limit,
          locale: locale,
          surface: appClientSurface,
          tenant: pb.TenantContext(tenantId: tenantId),
          token: token.isEmpty ? null : token,
        ),
      );
      return MyPurchasePage(
        purchases: List.unmodifiable(
          body.purchases
              .map(_purchase)
              // A row naming nothing to open is a row no screen could
              // render.
              .nonNulls,
        ),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// A purchase names exactly one of an episode, a volume, and the rest of a
  /// series. One naming none reads as an episode, which is what every
  /// purchase was before the other two existed.
  MyPurchase? _purchase(pb.MyPurchase purchase) {
    final episode = purchase.episode;
    final series = purchase.series;
    final episodeId = episode.publicId.trim();
    final seriesId = series.publicId.trim();
    final item = purchase.hasVolume()
        ? PurchasedItem.volume
        : purchase.hasSeriesBundle()
        ? PurchasedItem.remainingEpisodes
        : PurchasedItem.episode;
    if (seriesId.isEmpty ||
        (item == PurchasedItem.episode && episodeId.isEmpty)) {
      return null;
    }
    return MyPurchase(
      id: purchase.id.trim(),
      seriesId: seriesId,
      seriesTitle: series.title.trim(),
      seriesLocale: series.locale.trim(),
      item: item,
      episodeId: item == PurchasedItem.episode ? episodeId : '',
      episodeTitle: item == PurchasedItem.episode ? episode.title.trim() : '',
      episodeLocale: item == PurchasedItem.episode ? episode.locale.trim() : '',
      orderIndex: item == PurchasedItem.episode ? episode.orderIndex : 0,
      volumeTitle: purchase.volume.title.trim(),
      remainingEpisodeCount: purchase.seriesBundle.episodeCount,
      price: purchase.priceAtPurchase,
      currency: purchase.currency.trim(),
      isActive: purchase.isActive,
      // Unspecified, which the server never answers, reads as the permanent
      // copy.
      kind: purchase.kind == pb.PurchaseKind.PURCHASE_KIND_RENTAL
          ? PurchaseKind.rental
          : PurchaseKind.purchase,
      refundedAmount: purchase.refundedAmount,
      purchasedAt: _readInstant(purchase.purchasedAt),
      expiresAt: _readInstant(purchase.expiresAt),
      refundedAt: _readInstant(purchase.refundedAt),
      revokedAt: _readInstant(purchase.revokedAt),
    );
  }

  DateTime? _readInstant(String value) =>
      DateTime.tryParse(value.trim())?.toLocal();

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
