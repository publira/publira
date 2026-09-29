/// How a tenant publishes the comments its readers write
/// (`publira.types.v1.CommentMode`).
enum CommentMode {
  /// Commenting is off: no comment section anywhere, and the API refuses a
  /// post. This is what a tenant that has never chosen gets.
  disabled,

  /// A posted comment is readable by everyone as soon as it is stored.
  immediate,

  /// A posted comment waits for a staff approval before anyone but its author
  /// can read it.
  approvalRequired;

  /// The mode [wireValue] names, which protojson writes as the enum's own
  /// name and omits entirely when it is the zero value.
  ///
  /// Anything this build cannot name is [disabled]. Offering a comment box for
  /// a policy the app does not know would take comments the API then refuses,
  /// which is worse for the reader than a section that is not there.
  static CommentMode fromWire(Object? wireValue) => switch (wireValue) {
    'COMMENT_MODE_IMMEDIATE' => CommentMode.immediate,
    'COMMENT_MODE_APPROVAL_REQUIRED' => CommentMode.approvalRequired,
    _ => CommentMode.disabled,
  };

  /// Whether this tenant takes comments at all, which is what decides that the
  /// app offers the section rather than how a posted comment is published.
  bool get takesComments => this != CommentMode.disabled;
}

/// Why a reader says a comment breaks the rules
/// (`publira.v1.CommentReportReason`).
///
/// The list is short on purpose: a reporter picks from it in one glance, and
/// staff working the queue can sort by it. The declaration order is the order
/// the chooser offers, ending with the one that asks for a sentence.
enum CommentReportReason {
  spam('COMMENT_REPORT_REASON_SPAM'),
  abuse('COMMENT_REPORT_REASON_ABUSE'),
  spoiler('COMMENT_REPORT_REASON_SPOILER'),
  other('COMMENT_REPORT_REASON_OTHER');

  const CommentReportReason(this.wireValue);

  final String wireValue;
}

/// One comment as a screen renders it, whoever wrote it.
///
/// [awaitingApproval] is true only for a comment nobody but its author can
/// read yet. It is deliberately **not** a removal flag: a comment staff took
/// down keeps whatever value it had, because its author is never told
/// (`proto/publira/v1/comment.proto`).
class EpisodeComment {
  const EpisodeComment({
    required this.id,
    required this.body,
    required this.createdAt,
    this.authorId = '',
    this.authorName = '',
    this.awaitingApproval = false,
  });

  final String id;
  final String body;

  /// When the comment was posted, `null` when the API sent a timestamp this
  /// build could not read. Such a row still renders — its text is what the
  /// reader came for — with no date beside it.
  final DateTime? createdAt;

  /// Empty on a row that reached the app through the caller's own list, which
  /// leaves out the author the caller already is. [byAuthor] fills it in.
  final String authorId;
  final String authorName;

  final bool awaitingApproval;

  /// The same comment credited to the reader who wrote it.
  ///
  /// `ListMyEpisodeComments` does not repeat the caller's own name back to
  /// them, so the app names them from the session it holds and the row then
  /// renders among the public ones without a case of its own.
  EpisodeComment byAuthor({required String id, required String name}) {
    return EpisodeComment(
      id: this.id,
      body: body,
      createdAt: createdAt,
      authorId: id,
      authorName: name,
      awaitingApproval: awaitingApproval,
    );
  }
}

/// One page of an episode's published comments, newest first.
class EpisodeCommentPage {
  const EpisodeCommentPage({
    this.comments = const [],
    this.previousToken = '',
    this.nextToken = '',
  });

  final List<EpisodeComment> comments;

  /// Token for the page of newer comments, empty on the newest page.
  final String previousToken;

  /// Token for the page of older comments, empty on the oldest page.
  final String nextToken;
}
