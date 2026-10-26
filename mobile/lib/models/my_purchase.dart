import 'dart:ui';

import 'package:publira/l10n/locale_negotiation.dart';

/// Which of an episode's sales a reader buys or bought, as
/// `publira.types.v1.PurchaseKind` names them.
enum PurchaseKind {
  /// The permanent copy, at the episode's price, which opens it for its
  /// reading period if it has one and for good if it does not. A store
  /// purchase is always this.
  purchase,

  /// The rental, at the episode's rental price, which opens it for the rental
  /// period.
  rental,
}

/// What one purchase bought, under the names the purchase history CSV writes
/// in its `item` column.
enum PurchasedItem {
  /// One episode.
  episode('episode'),

  /// A volume of the series, which opens every episode it holds.
  volume('volume'),

  /// Every episode of the series the reader did not own yet when they bought
  /// the rest of it.
  remainingEpisodes('remaining_episodes'),

  /// A pack of the tenant's coins, which belongs to no series and opens
  /// nothing itself.
  coinPack('coin_pack');

  const PurchasedItem(this.wireName);

  final String wireName;
}

/// One purchase belonging to the signed-in reader, as `publira.v1.MyPurchase`
/// describes it.
class MyPurchase {
  const MyPurchase({
    required this.id,
    required this.seriesId,
    required this.seriesTitle,
    this.seriesLocale = '',
    this.item = PurchasedItem.episode,
    this.episodeId = '',
    this.episodeTitle = '',
    this.episodeLocale = '',
    this.orderIndex = 0,
    this.volumeTitle = '',
    this.remainingEpisodeCount = 0,
    this.coins = 0,
    this.bonusCoins = 0,
    this.coinName = '',
    required this.price,
    required this.currency,
    required this.isActive,
    this.kind = PurchaseKind.purchase,
    this.refundedAmount = 0,
    this.purchasedAt,
    this.expiresAt,
    this.refundedAt,
    this.revokedAt,
  });

  final String id;

  /// The series of the episode, the volume, or the rest of a series bought,
  /// and empty for a pack of coins, which is of no series.
  final String seriesId;
  final String seriesTitle;

  /// The locale [seriesTitle] was answered in, named the way
  /// `SeriesItem.locale` is.
  final String seriesLocale;

  /// What the purchase bought. The episode fields are set on a purchase of an
  /// episode alone, [volumeTitle] on one of a volume,
  /// [remainingEpisodeCount] on one of the rest of the series, and the coin
  /// fields on one of a pack.
  final PurchasedItem item;

  final String episodeId;
  final String episodeTitle;

  /// The locale [episodeTitle] was answered in, which falls back apart from
  /// [seriesLocale].
  final String episodeLocale;

  /// [seriesLocale] and [episodeLocale] as a text widget takes them, the way
  /// `SeriesItem.textLocale` is.
  Locale? get seriesTextLocale => supportedLocaleForCode(seriesLocale);
  Locale? get episodeTextLocale => supportedLocaleForCode(episodeLocale);

  final int orderIndex;

  /// The title of the volume bought, written in the tenant's own words.
  final String volumeTitle;

  /// How many episodes buying the rest of the series opened.
  final int remainingEpisodeCount;

  /// The coins and the bonus coins of a pack as the reader was shown them when
  /// they bought it, however the pack has changed since.
  final int coins;
  final int bonusCoins;

  /// Every coin a pack granted, its bonus coins among them.
  int get grantedCoins => coins + bonusCoins;

  /// The tenant's word for its coins in the locale the list was read in, which
  /// a screen names the coins by instead of a word of the app's own.
  final String coinName;

  /// What the reader paid, in the minor unit of [currency].
  final int price;

  /// The ISO 4217 code of the currency the reader paid in. Empty for a row
  /// that names none, whose price is not shown.
  final String currency;

  /// Whether the purchase still opens what it bought, as the API judged it
  /// when the page was read.
  final bool isActive;

  /// Which sale the reader bought. A rental always carries [expiresAt].
  final PurchaseKind kind;

  /// `null` when the API sent a timestamp this build could not read.
  final DateTime? purchasedAt;

  /// `null` for a purchase that does not expire.
  final DateTime? expiresAt;

  /// What has been refunded to the reader so far, in the same unit as
  /// [price].
  final int refundedAmount;

  /// When the refunds reached [price], and `null` until they do.
  final DateTime? refundedAt;

  /// When the purchase stopped opening its episode before its reading period
  /// ran out — refunded in full, disputed, or refunded by staff — and `null`
  /// for one that never did.
  final DateTime? revokedAt;

  /// Why the purchase does or does not open its episode, decided the way the
  /// site's purchase library decides it: a full refund first, then any other
  /// revocation, and only then the reading period.
  MyPurchaseStatus get status {
    if (refundedAt != null) {
      return MyPurchaseStatus.refunded;
    }
    if (revokedAt != null) {
      return MyPurchaseStatus.canceled;
    }
    return isActive ? MyPurchaseStatus.active : MyPurchaseStatus.expired;
  }
}

/// What the purchase library marks a purchase as, under the names the
/// purchase history CSV writes in its `status` column.
enum MyPurchaseStatus {
  /// Still opens its episode.
  active('active'),

  /// Its reading period ran out.
  expired('expired'),

  /// Refunded in full.
  refunded('refunded'),

  /// Revoked with nothing refunded in full: a dispute, or a staff refund the
  /// payment provider has not reported yet.
  canceled('canceled');

  const MyPurchaseStatus(this.wireName);

  final String wireName;
}

/// One page of the reader's purchases, newest first, as
/// `ListMyPurchasesResponse` answers it.
///
/// Only [nextToken] is kept, for the reason `MyFollowPage` keeps only its own:
/// the list walks forward and keeps what it already read on screen.
class MyPurchasePage {
  const MyPurchasePage({required this.purchases, this.nextToken = ''});

  /// A reader who has bought nothing, which is also what a guest is answered.
  static const empty = MyPurchasePage(purchases: []);

  final List<MyPurchase> purchases;

  /// What the API calls the page after this one. Empty at the end of the list.
  final String nextToken;
}
