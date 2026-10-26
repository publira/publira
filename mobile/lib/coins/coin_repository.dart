/// @docImport 'package:publira/app.dart';
library;

import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/models/my_purchase.dart';

/// How many entries one page of the reader's coin history holds, which is
/// also the API's own fallback for a request naming no limit.
const coinTransactionPageLimit = 20;

/// The store product a pack is sold as in both stores: `coins_` followed by
/// the pack's id in lowercase hexadecimal, without hyphens, as
/// `StartStorePurchase` names it and the console's **Store products** lists
/// it.
String coinPackProductId(String coinPackId) =>
    'coins_${coinPackId.replaceAll('-', '').toLowerCase()}';

/// Whether [productId] is the store product of a pack of coins.
bool isCoinPackProduct(String productId) => productId.startsWith('coins_');

/// A key naming one payment with coins, which `PayEpisodeWithCoins` spends
/// once however many times it is sent.
String newCoinPaymentKey() {
  final random = Random.secure();
  return [
    for (var i = 0; i < 16; i++)
      random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ].join();
}

/// What the tenant has to disclose wherever its coins are sold: who issues
/// them, the terms they are sold under, how to reach the issuer, and a notice
/// in the tenant's own words. Each is empty where the tenant wrote nothing.
class CoinDisclosures {
  const CoinDisclosures({
    this.issuerName = '',
    this.termsUrl,
    this.contact = '',
    this.notice = '',
  });

  static const none = CoinDisclosures();

  final String issuerName;

  /// An http or https URL, or `null` where the tenant gave none.
  final Uri? termsUrl;
  final String contact;
  final String notice;

  bool get isEmpty =>
      issuerName.isEmpty &&
      termsUrl == null &&
      contact.isEmpty &&
      notice.isEmpty;
}

/// A pack of coins the tenant has on sale.
class CoinPack {
  const CoinPack({required this.id, required this.coins, this.bonusCoins = 0});

  /// The pack's primary key, which `StartStorePurchase` takes.
  final String id;

  /// The coins a purchase grants, and the bonus coins it grants on top.
  final int coins;
  final int bonusCoins;

  /// Every coin a purchase adds to the balance.
  int get totalCoins => coins + bonusCoins;

  /// The store product the pack is sold as.
  String get productId => coinPackProductId(id);
}

/// What the app needs to show the tenant's coins at all, as
/// `GetCoinSettings` answers it.
class CoinSettings {
  const CoinSettings({
    required this.coinName,
    required this.expiryDays,
    required this.selling,
    this.packs = const [],
    this.disclosures = CoinDisclosures.none,
  });

  /// The tenant's word for its coins in the reader's locale, which every
  /// string that names them carries.
  final String coinName;

  /// How many days after purchase a coin can be spent.
  final int expiryDays;

  /// Whether the tenant sells packs now. A tenant that stopped still lets
  /// readers spend what they hold.
  final bool selling;

  /// The packs on sale, in the order the tenant sells them. Empty while
  /// [selling] is false.
  final List<CoinPack> packs;

  final CoinDisclosures disclosures;
}

/// A reader's coins, as `GetCoinBalance` answers them.
class CoinBalance {
  const CoinBalance({
    required this.coins,
    required this.coinName,
    this.nearestExpiryAt,
    this.nearestExpiryCoins = 0,
    this.owedCoins = 0,
  });

  /// What the reader can spend now.
  final int coins;

  /// The tenant's word for its coins, as [CoinSettings.coinName] is.
  final String coinName;

  /// When the coins that expire first expire, and how many of [coins] do
  /// then. `null` and 0 while the balance is 0.
  final DateTime? nearestExpiryAt;
  final int nearestExpiryCoins;

  /// Coins of a refunded pack that had already been spent, which the next
  /// grant pays back before any coin of it can be spent.
  final int owedCoins;
}

/// Which way an entry of the coin history moved the reader's coins.
enum CoinTransactionKind {
  /// Coins added to the balance.
  grant,

  /// Coins spent on an episode.
  spend,

  /// Coins taken back after the pack that granted them was refunded.
  revocation,

  /// Coins that lapsed unspent.
  expiry,

  /// Coins of a refunded pack that had already been spent, which the reader
  /// now owes. It moves no coins.
  shortfall,

  /// Coins taken out of a grant to pay what the reader owed.
  shortfallSettlement,
}

/// One entry of the reader's coin history.
class CoinTransaction {
  const CoinTransaction({
    required this.id,
    required this.kind,
    required this.coins,
    required this.createdAt,
    this.expiresAt,
    this.seriesId = '',
    this.episodeId = '',
    this.episodeTitle = '',
    this.episodeLocale = '',
  });

  final String id;
  final CoinTransactionKind kind;

  /// How many coins moved, always positive: [kind] says which way.
  final int coins;

  final DateTime createdAt;

  /// On a grant, when the coins it added expire.
  final DateTime? expiresAt;

  /// On a spend, the public ids of the episode it paid for and its series,
  /// and the episode's title in the reader's locale. Empty on every other
  /// entry, and on a spend whose episode the app may not show.
  final String seriesId;
  final String episodeId;
  final String episodeTitle;
  final String episodeLocale;
}

/// One page of the reader's coin history, newest first.
class CoinTransactionPage {
  const CoinTransactionPage({
    required this.transactions,
    required this.coinName,
    this.nextToken = '',
  });

  final List<CoinTransaction> transactions;

  /// The word every amount in [transactions] is counted in.
  final String coinName;

  /// What the API calls the page under this one. Empty on the last page.
  final String nextToken;
}

/// The tenant's coins and the signed-in reader's balance of them, through
/// `publira.v1.CoinService`.
///
/// Every call throws [CoinFailure] with [CoinFailureKind.unavailable] while
/// the platform or the tenant has coins off, and the app then shows nothing
/// about them. Each takes the reader's `locale`, which the tenant's word for
/// its coins and every title are given in.
abstract class CoinRepository {
  /// What the tenant's coins are and the packs it sells. Needs no session.
  Future<CoinSettings> settings({required String locale});

  /// What the signed-in reader holds. A guest is answered
  /// [CoinFailureKind.sessionExpired] without a request.
  Future<CoinBalance> balance({required String locale});

  /// The page of the signed-in reader's coin history [token] names, and the
  /// first page for an empty one.
  Future<CoinTransactionPage> transactions({
    required String locale,
    String token = '',
    int limit = coinTransactionPageLimit,
  });

  /// Opens the [kind] of the episode [episodeInternalId] names by spending
  /// [coins], the price the reader was shown, and answers the balance left.
  /// [idempotencyKey] names this one payment, so sending it again spends
  /// nothing more.
  ///
  /// Throws [CoinFailure]; [CoinFailureKind.priceChanged] and
  /// [CoinFailureKind.insufficient] spend nothing.
  Future<CoinBalance> payEpisode(
    String episodeInternalId, {
    required int coins,
    required String idempotencyKey,
    required String locale,
    PurchaseKind kind = PurchaseKind.purchase,
  });
}

/// The pack among [packs] that covers [needed] coins with the fewest coins,
/// the first in the tenant's order of two that grant as many, or `null` where
/// none is large enough.
T? coinPackCovering<T extends CoinPack>(Iterable<T> packs, int needed) {
  T? best;
  for (final pack in packs) {
    if (pack.totalCoins < needed) {
      continue;
    }
    if (best == null || pack.totalCoins < best.totalCoins) {
      best = pack;
    }
  }
  return best;
}

/// Looks up the [CoinRepository] installed by [PubliraApp].
class CoinScope extends InheritedWidget {
  const CoinScope({super.key, this.repository, required super.child});

  final CoinRepository? repository;

  /// `null` when this run shows nothing about coins, which is what a widget
  /// test that does not care about them builds.
  static CoinRepository? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<CoinScope>()?.repository;

  @override
  bool updateShouldNotify(CoinScope oldWidget) =>
      repository != oldWidget.repository;
}
