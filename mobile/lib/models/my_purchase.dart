/// One purchase belonging to the signed-in reader, as `publira.v1.MyPurchase`
/// describes it.
class MyPurchase {
  const MyPurchase({
    required this.id,
    required this.seriesId,
    required this.seriesTitle,
    required this.episodeId,
    required this.episodeTitle,
    required this.orderIndex,
    required this.price,
    required this.currency,
    required this.isActive,
    this.refundedAmount = 0,
    this.purchasedAt,
    this.expiresAt,
    this.refundedAt,
    this.revokedAt,
  });

  final String id;
  final String seriesId;
  final String seriesTitle;
  final String episodeId;
  final String episodeTitle;
  final int orderIndex;

  /// What the reader paid, in the minor unit of [currency].
  final int price;

  /// The ISO 4217 code of the currency the reader paid in. Empty for a row
  /// that names none, whose price is not shown.
  final String currency;

  /// Whether the purchase still opens the episode, as the API judged it when
  /// the page was read.
  final bool isActive;

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
