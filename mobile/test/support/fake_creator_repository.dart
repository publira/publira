import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_repository.dart';
import 'package:publira/models/my_creator.dart';

/// [CreatorRepository] that answers from what a test sets on it, one page at
/// a time: each list is answered in pages of the given size, with the index of
/// the next as its token.
class FakeCreatorRepository implements CreatorRepository {
  FakeCreatorRepository({
    this.enabled = true,
    this.creators = MyCreators.none,
    Map<String, MyCreatorStats>? figures,
    Map<String, List<MyCreatorStatement>>? statements,
    Map<(String, String), List<MyCreatorStatementLine>>? lines,
    this.pageSize = 20,
  }) : figures = figures ?? {},
       statements = statements ?? {},
       lines = lines ?? {};

  /// What [pagesEnabled] answers.
  bool enabled;

  /// What [listMyCreators] answers.
  MyCreators creators;

  /// Each Author's figures by [MyCreator.id], whose episodes are paged.
  final Map<String, MyCreatorStats> figures;

  /// Each Author's closed months by [MyCreator.id], newest first.
  final Map<String, List<MyCreatorStatement>> statements;

  /// The lines of each Author's month, by [MyCreator.id] and `YYYY-MM`.
  final Map<(String, String), List<MyCreatorStatementLine>> lines;

  /// How many rows one page holds when the call names no limit.
  int pageSize;

  /// Thrown by every call but [pagesEnabled], standing in for an API that
  /// refuses or cannot be reached.
  CreatorFailure? failure;

  /// Thrown by [stats] and [listStatements] alone, so one section of a page
  /// fails while the rest reads.
  CreatorFailure? statsFailure;
  CreatorFailure? statementsFailure;

  /// The calls made, by method name, in order.
  final calls = <String>[];

  ({List<T> rows, String nextToken}) _page<T>(
    List<T> rows,
    String token,
    int size,
  ) {
    final start = token.isEmpty ? 0 : int.parse(token);
    final end = (start + size).clamp(0, rows.length);
    return (
      rows: rows.sublist(start, end),
      nextToken: end < rows.length ? '$end' : '',
    );
  }

  void _throwIfFailing([CreatorFailure? specific]) {
    final failure = specific ?? this.failure;
    if (failure != null) {
      throw failure;
    }
  }

  @override
  Future<bool> pagesEnabled() async {
    calls.add('pagesEnabled');
    return enabled;
  }

  @override
  Future<MyCreators> listMyCreators() async {
    calls.add('listMyCreators');
    _throwIfFailing();
    return creators;
  }

  @override
  Future<MyCreatorStats> stats({
    required String creatorId,
    required String locale,
    String token = '',
  }) async {
    calls.add('stats');
    _throwIfFailing(statsFailure);
    final stats = figures[creatorId];
    if (stats == null) {
      throw const CreatorFailure(CreatorFailureKind.unavailable);
    }
    final page = _page(stats.episodes, token, pageSize);
    return MyCreatorStats(
      periodStart: stats.periodStart,
      periodEnd: stats.periodEnd,
      timeZone: stats.timeZone,
      followerCount: stats.followerCount,
      totalMemberViewCount: stats.totalMemberViewCount,
      totalCompleteCount: stats.totalCompleteCount,
      currency: stats.currency,
      episodes: page.rows,
      nextToken: page.nextToken,
    );
  }

  @override
  Future<MyCreatorStatementPage> listStatements({
    required String creatorId,
    String token = '',
  }) async {
    calls.add('listStatements');
    _throwIfFailing(statementsFailure);
    if (!creators.salesVisible) {
      throw const CreatorFailure(CreatorFailureKind.unavailable);
    }
    final page = _page(
      statements[creatorId] ?? const <MyCreatorStatement>[],
      token,
      pageSize,
    );
    return MyCreatorStatementPage(
      statements: page.rows,
      nextToken: page.nextToken,
    );
  }

  @override
  Future<MyCreatorStatementDetail> statement({
    required String creatorId,
    required String period,
    String token = '',
    int? limit,
  }) async {
    calls.add('statement');
    _throwIfFailing();
    final statement = (statements[creatorId] ?? const [])
        .where((statement) => statement.period == period)
        .firstOrNull;
    if (!creators.salesVisible || statement == null) {
      throw const CreatorFailure(CreatorFailureKind.unavailable);
    }
    final page = _page(
      lines[(creatorId, period)] ?? const <MyCreatorStatementLine>[],
      token,
      limit ?? pageSize,
    );
    return MyCreatorStatementDetail(
      statement: statement,
      lines: page.rows,
      nextToken: page.nextToken,
    );
  }
}
