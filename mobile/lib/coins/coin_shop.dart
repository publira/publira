import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';

/// A pack the store on this device sells, at the price the store names.
class StoreCoinPack extends CoinPack {
  StoreCoinPack(CoinPack pack, {required this.price})
    : super(id: pack.id, coins: pack.coins, bonusCoins: pack.bonusCoins);

  /// What the store charges, formatted by the store for the reader's
  /// storefront, which is what Apple and Google require an app to quote.
  final String price;
}

/// The tenant's coins as the app sells them: what they are, and the packs
/// this device can buy.
class CoinShop {
  const CoinShop({required this.settings, required this.packs});

  final CoinSettings settings;

  /// The packs on sale that the store on this device sells, in the tenant's
  /// order. Empty while the tenant is not selling, where the device cannot
  /// pay, and for a pack the tenant has not created in the store.
  final List<StoreCoinPack> packs;
}

/// Whether the app shows the tenant's coins at all: the tenant's app sells
/// through the store, which is the only way an app sells a pack. A tenant
/// whose app sells through the web checkout cannot sell coins there, so the
/// app shows nothing about them, whatever the API would answer.
///
/// A route that cannot be read shows nothing either.
Future<bool> appShowsCoins(PurchaseRepository purchase) async {
  try {
    return await purchase.appPurchaseRoute() == AppPurchaseRoute.store;
  } on PurchaseFailure {
    return false;
  }
}

/// The tenant's coin settings and the packs [purchaser] can sell, each at
/// the store's price.
///
/// Throws [CoinFailure]; [CoinFailureKind.unavailable] while the tenant has
/// coins off.
Future<CoinShop> readCoinShop({
  required CoinRepository coins,
  required PurchaseRepository purchase,
  required StorePurchaser? purchaser,
  required String locale,
}) async {
  final settings = await coins.settings(locale: locale);
  final onSale = settings.selling ? settings.packs : const <CoinPack>[];
  if (onSale.isEmpty || purchaser == null) {
    return CoinShop(settings: settings, packs: const []);
  }
  final payable = await purchase.acceptsPayments().onError<PurchaseFailure>(
    (_, _) => false,
  );
  final prices = payable
      ? await purchaser.prices({for (final pack in onSale) pack.productId})
      : const <String, String>{};
  return CoinShop(
    settings: settings,
    packs: List.unmodifiable([
      for (final pack in onSale)
        if (prices[pack.productId] case final price?)
          StoreCoinPack(pack, price: price),
    ]),
  );
}

/// What a locked episode's gate offers a signed-in reader for the tenant's
/// coins.
sealed class CoinGateOffer {
  const CoinGateOffer();
}

/// The reader's balance could not be read, which the gate says instead of an
/// offer.
class CoinOfferFailed extends CoinGateOffer {
  const CoinOfferFailed();
}

/// The episode paid for with the coins the reader holds, or, when those fall
/// short of the permanent copy, the pack that covers the difference.
class CoinOffer extends CoinGateOffer {
  const CoinOffer({
    required this.balance,
    required this.coinName,
    required this.price,
    required this.rentalPrice,
    required this.needed,
    required this.purchaseKey,
    required this.rentalKey,
    this.pack,
    this.packsOnSale = false,
    this.expiryDays = 0,
    this.disclosures = CoinDisclosures.none,
  });

  /// What the reader can spend now.
  final int balance;
  final String coinName;

  /// The permanent copy's price in coins, and the rental's; 0 on an episode
  /// not sold that way.
  final int price;
  final int rentalPrice;

  /// The coins the reader still needs for the permanent copy: its price less
  /// the balance, plus what the next pack pays back of a refunded one. 0 when
  /// the balance covers it.
  final int needed;

  /// Name the payment for the permanent copy and the one for the rental, so
  /// a second tap or a retry of either spends nothing more. Each sale keeps a
  /// key of its own: the API refuses a key that already paid for the other.
  final String purchaseKey;
  final String rentalKey;

  /// The smallest pack this device can buy that covers [needed]. `null` when
  /// the balance covers the permanent copy, and when no pack is large enough,
  /// where the gate sends the reader to every pack instead.
  final StoreCoinPack? pack;

  /// Whether this device can buy any pack at all.
  final bool packsOnSale;

  /// How many days a pack's coins can be spent for after purchase.
  final int expiryDays;

  /// The tenant's terms, stated beside a pack the gate sells.
  final CoinDisclosures disclosures;

  /// Whether the reader's coins pay for the permanent copy.
  bool get coversPurchase => needed == 0 && price > 0;

  /// Whether the reader's coins pay for the rental.
  bool get coversRental => rentalPrice > 0 && balance >= rentalPrice;

  /// Whether paying with coins is the gate's leading way in: the coins the
  /// reader holds open the episode without buying anything else.
  bool get leads => coversPurchase || coversRental;
}

/// What the gate of [detail] offers for the tenant's coins, or `null` where
/// it offers nothing about them: a guest, an episode that is not locked or
/// not priced in coins, one sold on the website alone, a tenant whose app
/// does not sell through the store, and a tenant that turned its coins off
/// since the episode was read.
///
/// The packs are read beside the balance, and a read of them that fails
/// offers none: the reader can still spend what they hold.
Future<CoinGateOffer?> readCoinGateOffer({
  required CoinRepository coins,
  required PurchaseRepository purchase,
  required StorePurchaser? purchaser,
  required EpisodeDetail detail,
  required bool signedIn,
  required String locale,
}) async {
  final episode = detail.episode;
  if (!signedIn ||
      detail.access != EpisodeAccess.locked ||
      !episode.isSoldForCoins ||
      episode.purchaseSurface == EpisodePurchaseSurface.web ||
      !await appShowsCoins(purchase)) {
    return null;
  }
  final shopRead = readCoinShop(
    coins: coins,
    purchase: purchase,
    purchaser: purchaser,
    locale: locale,
  ).then<CoinShop?>((shop) => shop).onError<CoinFailure>((_, _) => null);
  final CoinBalance balance;
  try {
    balance = await coins.balance(locale: locale);
  } on CoinFailure catch (failure) {
    shopRead.ignore();
    return switch (failure.kind) {
      // Coins went off since the episode was read, or the session went.
      CoinFailureKind.unavailable || CoinFailureKind.sessionExpired => null,
      _ => const CoinOfferFailed(),
    };
  }
  final shop = await shopRead;
  final needed = balance.coins >= episode.coinPrice
      ? 0
      : episode.coinPrice - balance.coins + balance.owedCoins;
  final packs = shop?.packs ?? const <StoreCoinPack>[];
  return CoinOffer(
    balance: balance.coins,
    coinName: episode.coinName,
    price: episode.coinPrice,
    rentalPrice: episode.isRented ? episode.coinRentalPrice : 0,
    needed: needed,
    purchaseKey: newCoinPaymentKey(),
    rentalKey: newCoinPaymentKey(),
    pack: needed > 0 ? coinPackCovering(packs, needed) : null,
    packsOnSale: packs.isNotEmpty,
    expiryDays: shop?.settings.expiryDays ?? 0,
    disclosures: shop?.settings.disclosures ?? CoinDisclosures.none,
  );
}
