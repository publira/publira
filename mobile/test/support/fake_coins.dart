import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/models/my_purchase.dart';

/// In-memory [CoinRepository] for widget tests: a tenant that names its coins
/// [coinName] and a reader holding [coins] of them.
class FakeCoinRepository implements CoinRepository {
  FakeCoinRepository({
    this.coinName = 'Points',
    this.coins = 0,
    this.packs = const [
      CoinPack(id: '0190a0a0-0000-7000-8000-000000000001', coins: 100),
      CoinPack(
        id: '0190a0a0-0000-7000-8000-000000000002',
        coins: 500,
        bonusCoins: 50,
      ),
    ],
    this.selling = true,
    this.disclosures = const CoinDisclosures(
      issuerName: 'Example Publishing',
      contact: 'support@example.com',
      notice: 'Unused Points are not refunded.',
    ),
  });

  /// The tenant's word for its coins, in whichever locale is asked.
  String coinName;

  /// What the reader holds now.
  int coins;

  /// Coins of a refunded pack the reader owes.
  int owedCoins = 0;

  List<CoinPack> packs;
  bool selling;
  CoinDisclosures disclosures;

  /// How many days a grant can be spent for.
  int expiryDays = 180;

  /// Thrown by every call, standing in for a tenant with coins off.
  CoinFailure? failure;

  /// Thrown by [balance] alone.
  CoinFailure? balanceFailure;

  /// Thrown by [payEpisode], which then spends nothing.
  CoinFailure? payFailure;

  /// Every history entry, newest first, served [pageSize] at a time.
  List<CoinTransaction> history = const [];
  int pageSize = coinTransactionPageLimit;

  /// Thrown by [transactions] for every page but the first.
  CoinFailure? moreFailure;

  /// Called for a payment [payEpisode] made, which is when the API starts
  /// answering the episode as the reader's.
  void Function(String episodeInternalId)? onPaid;

  /// The payments [payEpisode] made, in order.
  final List<
    ({
      String episodeId,
      int coins,
      String key,
      PurchaseKind kind,
      String locale,
    })
  >
  payments = [];

  /// The locale every call was asked in, in order.
  final List<String> locales = <String>[];

  /// The coins a pack grants, which a test adds once the store has sold one.
  void grant(int amount) => coins += amount;

  @override
  Future<CoinSettings> settings({required String locale}) async {
    locales.add(locale);
    if (failure case final failure?) {
      throw failure;
    }
    return CoinSettings(
      coinName: coinName,
      expiryDays: expiryDays,
      selling: selling,
      packs: selling ? packs : const [],
      disclosures: disclosures,
    );
  }

  @override
  Future<CoinBalance> balance({required String locale}) async {
    locales.add(locale);
    if (failure ?? balanceFailure case final failure?) {
      throw failure;
    }
    return _balance();
  }

  CoinBalance _balance() => CoinBalance(
    coins: coins,
    coinName: coinName,
    nearestExpiryAt: coins > 0 ? DateTime(2027, 4, 24, 12) : null,
    nearestExpiryCoins: coins,
    owedCoins: owedCoins,
  );

  @override
  Future<CoinTransactionPage> transactions({
    required String locale,
    String token = '',
    int limit = coinTransactionPageLimit,
  }) async {
    locales.add(locale);
    if (failure case final failure?) {
      throw failure;
    }
    final start = token.isEmpty ? 0 : int.parse(token);
    if (start > 0 && moreFailure != null) {
      throw moreFailure!;
    }
    final end = (start + pageSize).clamp(0, history.length);
    return CoinTransactionPage(
      transactions: history.sublist(start, end),
      coinName: coinName,
      nextToken: end < history.length ? '$end' : '',
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
    locales.add(locale);
    if (failure ?? payFailure case final failure?) {
      throw failure;
    }
    if (this.coins < coins) {
      throw const CoinFailure(CoinFailureKind.insufficient);
    }
    this.coins -= coins;
    payments.add((
      episodeId: episodeInternalId,
      coins: coins,
      key: idempotencyKey,
      kind: kind,
      locale: locale,
    ));
    onPaid?.call(episodeInternalId);
    return _balance();
  }
}
