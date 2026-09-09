import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/models/episode_comment.dart';

/// One report a test can read back, as the reader sent it.
class RecordedReport {
  const RecordedReport({
    required this.commentPublicId,
    required this.reason,
    required this.note,
  });

  final String commentPublicId;
  final CommentReportReason reason;
  final String note;
}

/// In-memory [CommentRepository] for widget tests.
class FakeCommentRepository implements CommentRepository {
  FakeCommentRepository({
    this.mode = CommentMode.immediate,
    Map<String, EpisodeCommentPage>? pages,
    this.own = const [],
    this.modeFailure,
    this.listFailure,
    this.ownFailure,
    this.postFailure,
    this.withdrawFailure,
    this.reportFailure,
  }) : pages = pages ?? {'': const EpisodeCommentPage()};

  CommentMode mode;

  /// Public pages keyed by the cursor that opens them, the empty key being the
  /// newest page.
  Map<String, EpisodeCommentPage> pages;

  /// The caller's own comments the public list omits, which carry no author
  /// the way `ListMyEpisodeComments` answers.
  List<EpisodeComment> own;

  CommentFailure? modeFailure;
  CommentFailure? listFailure;
  CommentFailure? ownFailure;
  CommentFailure? postFailure;
  CommentFailure? withdrawFailure;
  CommentFailure? reportFailure;

  /// Cursors [listComments] was asked for, in order.
  final tokens = <String>[];

  /// Bodies [post] was given, in order.
  final posted = <String>[];

  /// Comments [withdraw] was asked to take down, in order.
  final withdrawn = <String>[];

  final reports = <RecordedReport>[];

  @override
  Future<CommentMode> commentMode() async {
    final failure = modeFailure;
    if (failure != null) {
      throw failure;
    }
    return mode;
  }

  @override
  Future<EpisodeCommentPage> listComments(
    String episodePublicId, {
    String token = '',
  }) async {
    tokens.add(token);
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    return pages[token] ?? const EpisodeCommentPage();
  }

  @override
  Future<List<EpisodeComment>> listMyComments(String episodePublicId) async {
    final failure = ownFailure;
    if (failure != null) {
      throw failure;
    }
    return List<EpisodeComment>.from(own);
  }

  @override
  Future<EpisodeComment> post({
    required String episodePublicId,
    required String body,
  }) async {
    final failure = postFailure;
    if (failure != null) {
      throw failure;
    }
    posted.add(body);
    final stored = EpisodeComment(
      id: 'comment-${posted.length}',
      body: body,
      createdAt: DateTime.utc(2026, 9, 9, 12, posted.length),
      awaitingApproval: mode == CommentMode.approvalRequired,
    );
    // Where the API puts it: under approval it reaches nobody but its author,
    // and even published it takes a moment to reach the shared list, which is
    // what the caller's own list is there to cover.
    own = [stored, ...own];
    return stored;
  }

  @override
  Future<void> withdraw(String commentPublicId) async {
    final failure = withdrawFailure;
    if (failure != null) {
      throw failure;
    }
    withdrawn.add(commentPublicId);
    own = own.where((comment) => comment.id != commentPublicId).toList();
    pages = {
      for (final entry in pages.entries)
        entry.key: EpisodeCommentPage(
          comments: entry.value.comments
              .where((comment) => comment.id != commentPublicId)
              .toList(),
          previousToken: entry.value.previousToken,
          nextToken: entry.value.nextToken,
        ),
    };
  }

  @override
  Future<void> report({
    required String commentPublicId,
    required CommentReportReason reason,
    String note = '',
  }) async {
    final failure = reportFailure;
    if (failure != null) {
      throw failure;
    }
    reports.add(
      RecordedReport(
        commentPublicId: commentPublicId,
        reason: reason,
        note: note,
      ),
    );
  }
}
