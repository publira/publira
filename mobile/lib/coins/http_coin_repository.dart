import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/coin.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/models/my_purchase.dart';

/// [CoinRepository] backed by `publira.v1.CoinService`.
class HttpCoinRepository implements CoinRepository {
  const HttpCoinRepository({required this._client, required this._tenants});

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<CoinSettings> settings({required String locale}) async {
    try {
      final tenantId = await _tenants.resolve();
      // Optional authentication: the client sends whatever session it holds.
      final body = await pb.CoinServiceApi(_client).getCoinSettings(
        ConnectCallContext(tenantId: tenantId),
        pb.GetCoinSettingsRequest(
          locale: locale,
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
      final settings = body.settings;
      final disclosures = settings.disclosures;
      return CoinSettings(
        coinName: _coinName(settings.coinName),
        expiryDays: settings.expiryDays,
        selling: settings.selling,
        packs: List.unmodifiable([
          // A pack that names no id is one the store could not be asked for.
          for (final pack in settings.packs)
            if (pack.id.trim().isNotEmpty && pack.coins > 0)
              CoinPack(
                id: pack.id.trim(),
                coins: pack.coins,
                bonusCoins: pack.bonusCoins,
              ),
        ]),
        disclosures: CoinDisclosures(
          issuerName: disclosures.issuerName.trim(),
          termsUrl: _webUrl(disclosures.termsUrl),
          contact: disclosures.contact.trim(),
          notice: disclosures.notice.trim(),
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<CoinBalance> balance({required String locale}) async {
    final body = await _call(
      (api, call, tenant) => api.getCoinBalance(
        call,
        pb.GetCoinBalanceRequest(locale: locale, tenant: tenant),
      ),
    );
    return _balance(body.balance);
  }

  @override
  Future<CoinTransactionPage> transactions({
    required String locale,
    String token = '',
    int limit = coinTransactionPageLimit,
  }) async {
    final body = await _call(
      (api, call, tenant) => api.listCoinTransactions(
        call,
        pb.ListCoinTransactionsRequest(
          limit: limit,
          locale: locale,
          surface: appClientSurface,
          tenant: tenant,
          token: token.isEmpty ? null : token,
        ),
      ),
    );
    return CoinTransactionPage(
      transactions: List.unmodifiable(
        body.transactions.map(_transaction).nonNulls,
      ),
      coinName: _coinName(body.coinName),
      nextToken: body.nextToken.trim(),
    );
  }

  @override
  Future<CoinBalance> payEpisode(
    String episodeInternalId, {
    required int coins,
    required String idempotencyKey,
    required String locale,
    PurchaseKind kind = PurchaseKind.purchase,
  }) async {
    final body = await _call(
      (api, call, tenant) => api.payEpisodeWithCoins(
        call,
        pb.PayEpisodeWithCoinsRequest(
          coins: coins,
          episodeId: episodeInternalId,
          idempotencyKey: idempotencyKey,
          kind: switch (kind) {
            PurchaseKind.purchase => pb.PurchaseKind.PURCHASE_KIND_PURCHASE,
            PurchaseKind.rental => pb.PurchaseKind.PURCHASE_KIND_RENTAL,
          },
          locale: locale,
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
    return _balance(body.balance);
  }

  /// Makes the call [send] makes through `api`, for the reader signed in now.
  ///
  /// The token is read once and sent explicitly, so the answer is about the
  /// reader who asked even when the account changes while the tenant lookup is
  /// in flight. A guest is answered without a request: the API needs a session
  /// for every call but the settings.
  Future<T> _call<T>(
    Future<T> Function(
      pb.CoinServiceApi api,
      ConnectCallContext call,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const CoinFailure(
        CoinFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        pb.CoinServiceApi(_client),
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.TenantContext(tenantId: tenantId),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  CoinBalance _balance(pb.CoinBalance balance) {
    return CoinBalance(
      coins: balance.coins.toInt(),
      coinName: _coinName(balance.coinName),
      nearestExpiryAt: _readInstant(balance.nearestExpiryAt),
      nearestExpiryCoins: balance.nearestExpiryCoins.toInt(),
      owedCoins: balance.shortfallCoins.toInt(),
    );
  }

  /// An entry of a kind this build has no name for says nothing it could
  /// show, and is dropped.
  CoinTransaction? _transaction(pb.CoinTransaction transaction) {
    final kind = _kinds[transaction.kind];
    final createdAt = _readInstant(transaction.createdAt);
    if (kind == null || createdAt == null) {
      return null;
    }
    // The wire format omits an unset message, which is how a spend on an
    // episode the app may not show arrives.
    final shown = transaction.hasEpisode() && transaction.hasSeries();
    return CoinTransaction(
      id: transaction.id.trim(),
      kind: kind,
      coins: transaction.coins,
      createdAt: createdAt,
      expiresAt: _readInstant(transaction.expiresAt),
      seriesId: shown ? transaction.series.publicId.trim() : '',
      episodeId: shown ? transaction.episode.publicId.trim() : '',
      episodeTitle: shown ? transaction.episode.title.trim() : '',
      episodeLocale: shown ? transaction.episode.locale.trim() : '',
    );
  }

  static const _kinds = {
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_GRANT:
        CoinTransactionKind.grant,
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_SPEND:
        CoinTransactionKind.spend,
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_REVOCATION:
        CoinTransactionKind.revocation,
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_EXPIRY:
        CoinTransactionKind.expiry,
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_SHORTFALL:
        CoinTransactionKind.shortfall,
    pb.CoinTransactionKind.COIN_TRANSACTION_KIND_SHORTFALL_SETTLEMENT:
        CoinTransactionKind.shortfallSettlement,
  };

  /// The tenant names its coins wherever it turns them on, so an answer that
  /// names nothing is one no screen could word.
  static String _coinName(String raw) {
    final name = raw.trim();
    if (name.isEmpty) {
      throw const CoinFailure(
        CoinFailureKind.unexpected,
        message: 'coinName is missing',
      );
    }
    return name;
  }

  /// The terms the system browser is handed, so nothing but an http or https
  /// URL is.
  static Uri? _webUrl(String raw) {
    final url = Uri.tryParse(raw.trim());
    if (url == null || !(url.isScheme('https') || url.isScheme('http'))) {
      return null;
    }
    return url;
  }

  DateTime? _readInstant(String value) =>
      DateTime.tryParse(value.trim())?.toLocal();

  CoinFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return CoinFailure(CoinFailureKind.network, message: error.message);
    }
    final kind = switch (error.code) {
      'unauthenticated' => CoinFailureKind.sessionExpired,
      'already_exists' => CoinFailureKind.alreadyOpen,
      'not_found' || 'permission_denied' => CoinFailureKind.gone,
      'resource_exhausted' => CoinFailureKind.tooManyRequests,
      'failed_precondition' => _preconditionKind(error.reasons),
      _ => CoinFailureKind.unexpected,
    };
    return CoinFailure(kind, message: error.message);
  }

  /// Which refusal a `failed_precondition` is, by the reason the API names in
  /// its ErrorInfo. One naming none is an episode not sold as asked.
  CoinFailureKind _preconditionKind(List<String> reasons) {
    for (final reason in reasons) {
      switch (reason) {
        case coinsUnavailableReason:
          return CoinFailureKind.unavailable;
        case coinPriceChangedReason:
          return CoinFailureKind.priceChanged;
        case coinBalanceInsufficientReason:
          return CoinFailureKind.insufficient;
      }
    }
    return CoinFailureKind.notSold;
  }
}
