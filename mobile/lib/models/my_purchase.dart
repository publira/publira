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
    required this.isActive,
    this.purchasedAt,
    this.expiresAt,
  });

  final String id;
  final String seriesId;
  final String seriesTitle;
  final String episodeId;
  final String episodeTitle;
  final int orderIndex;

  /// What the reader paid, in yen.
  final int price;

  /// Whether the purchase still opens the episode, as the API judged it when
  /// the page was read.
  final bool isActive;

  /// `null` when the API sent a timestamp this build could not read.
  final DateTime? purchasedAt;

  /// `null` for a purchase that does not expire.
  final DateTime? expiresAt;
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
