/// A creator the signed-in reader's account is linked to, as
/// `publira.v1.MyCreator` describes them.
class MyCreator {
  const MyCreator({
    required this.id,
    required this.publicId,
    required this.name,
    this.iconUrl,
    this.imageRequestHeaders = const {},
  });

  /// Internal id (`id`), which every other `CreatorService` call names the
  /// creator by, and which the app's routes to their pages carry.
  final String id;

  /// Public id (`public_id`), which names the creator in the statement CSV.
  final String publicId;
  final String name;

  /// Absolute image-server URL of the portrait, and `null` for a creator who
  /// has none.
  final Uri? iconUrl;

  /// Headers [iconUrl] must be fetched with.
  final Map<String, String> imageRequestHeaders;
}

/// The creators the account is linked to, oldest link first, as
/// `ListMyCreatorsResponse` answers them.
class MyCreators {
  const MyCreators({required this.creators, this.salesVisible = false});

  /// An account linked to no creator, which is also what an account holding a
  /// staff role in the tenant is answered.
  static const none = MyCreators(creators: []);

  final List<MyCreator> creators;

  /// Whether the tenant shows its creators their sales: the episodes' sales
  /// and net amounts, and the closed statements.
  final bool salesVisible;
}

/// One episode crediting the creator, as `MyCreatorEpisodeStats` describes
/// it.
class MyCreatorEpisodeStats {
  const MyCreatorEpisodeStats({
    required this.seriesPublicId,
    required this.seriesTitle,
    required this.episodePublicId,
    required this.episodeTitle,
    required this.memberViewCount,
    required this.completeCount,
    this.purchaseCount,
    this.netAmount,
  });

  final String seriesPublicId;
  final String seriesTitle;
  final String episodePublicId;
  final String episodeTitle;
  final int memberViewCount;
  final int completeCount;

  /// The sales made in the window, and their net of refunds in the minor unit
  /// of [MyCreatorStats.currency]. Both `null` while the tenant does not show
  /// its creators their sales.
  final int? purchaseCount;
  final int? netAmount;
}

/// How the creator's episodes were read over the tenant's last 28 whole days,
/// as `GetMyCreatorStatsResponse` answers it, with one page of the episodes.
class MyCreatorStats {
  const MyCreatorStats({
    required this.periodStart,
    required this.periodEnd,
    required this.timeZone,
    required this.followerCount,
    required this.totalMemberViewCount,
    required this.totalCompleteCount,
    required this.currency,
    required this.episodes,
    this.nextToken = '',
  });

  /// The first and the last day of the window, read by their fields: they
  /// are calendar days of [timeZone], with no instant behind them.
  final DateTime periodStart;
  final DateTime periodEnd;

  /// The IANA zone the window's days are counted in.
  final String timeZone;

  final int followerCount;

  /// Over every episode crediting the creator, not only [episodes].
  final int totalMemberViewCount;
  final int totalCompleteCount;

  /// The ISO 4217 code every [MyCreatorEpisodeStats.netAmount] is in.
  final String currency;

  /// Most completions first.
  final List<MyCreatorEpisodeStats> episodes;

  /// What the API calls the page of episodes after this one. Empty at the end.
  final String nextToken;
}

/// The creator's part of one closed month, as `MyCreatorStatement` describes
/// it.
class MyCreatorStatement {
  const MyCreatorStatement({
    required this.period,
    required this.timeZone,
    required this.closedAt,
    required this.currency,
    required this.saleCount,
    required this.grossAmount,
    required this.refundedAmount,
    required this.payoutAmount,
  });

  /// The month as `YYYY-MM`, which is how the routes and the CSV name it.
  final String period;

  /// The IANA zone the month was cut in.
  final String timeZone;
  final DateTime closedAt;

  /// The ISO 4217 code every amount is in.
  final String currency;
  final int saleCount;
  final int grossAmount;
  final int refundedAmount;
  final int payoutAmount;
}

/// One page of the closed months, newest first, as
/// `ListMyCreatorStatementsResponse` answers it.
class MyCreatorStatementPage {
  const MyCreatorStatementPage({required this.statements, this.nextToken = ''});

  final List<MyCreatorStatement> statements;

  /// What the API calls the page after this one. Empty at the end of the list.
  final String nextToken;
}

/// What one line of a statement credits, under the names the statement CSV
/// writes in its `source` column.
enum CreatorStatementLineSource {
  /// The episode's sales.
  sale('sale'),

  /// The parts of the month's subscription payments shared to the episode.
  subscription('subscription');

  const CreatorStatementLineSource(this.wireName);

  final String wireName;
}

/// One of the creator's lines of a closed statement, as
/// `MyCreatorStatementLine` describes it. Names are as they stood at close.
class MyCreatorStatementLine {
  const MyCreatorStatementLine({
    required this.lineNumber,
    this.seriesPublicId = '',
    required this.seriesTitle,
    this.episodePublicId = '',
    required this.episodeTitle,
    this.roleName = '',
    required this.saleCount,
    required this.grossAmount,
    required this.refundedAmount,
    required this.shareBps,
    required this.payoutAmount,
    this.adjustedPeriod = '',
    this.source = CreatorStatementLineSource.sale,
  });

  final int lineNumber;

  /// Empty once the row the line named has been deleted.
  final String seriesPublicId;
  final String seriesTitle;
  final String episodePublicId;
  final String episodeTitle;

  /// Empty for a credit that states no role.
  final String roleName;
  final int saleCount;
  final int grossAmount;
  final int refundedAmount;

  /// The credit's share in basis points: 10000 is all of it.
  final int shareBps;
  final int payoutAmount;

  /// `YYYY-MM` of the closed month an adjustment line adjusts, and empty for a
  /// line of the month's own sales or subscription payments.
  final String adjustedPeriod;
  final CreatorStatementLineSource source;

  bool get isAdjustment => adjustedPeriod.isNotEmpty;
}

/// One closed month and one page of the creator's lines in it, as
/// `GetMyCreatorStatementResponse` answers it.
class MyCreatorStatementDetail {
  const MyCreatorStatementDetail({
    required this.statement,
    required this.lines,
    this.nextToken = '',
  });

  final MyCreatorStatement statement;

  /// In line order: the month's sales, then its subscription payments, then
  /// its adjustments.
  final List<MyCreatorStatementLine> lines;

  /// What the API calls the page of lines after this one. Empty at the end.
  final String nextToken;
}
