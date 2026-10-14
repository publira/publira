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
    this.authorIconUrl,
    this.imageRequestHeaders = const {},
    this.creatorName = '',
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

  /// Absolute image-server URL of the icon the author's account shows now,
  /// and `null` for an account that shows none.
  ///
  /// An icon is stored as a single rendition, so the first variant the API
  /// lists is the icon, and image-server scales it to the size it is drawn at.
  final Uri? authorIconUrl;

  /// Headers [authorIconUrl] must be fetched with.
  final Map<String, String> imageRequestHeaders;

  /// The name this episode credits the author as, and empty on every comment
  /// whose author it does not credit.
  ///
  /// The server decides it per episode, so the same account reads as a
  /// creator on their own work and as a reader anywhere else. It arrives on
  /// the caller's own rows too, which is what keeps their comment marked
  /// before it is published.
  final String creatorName;

  final bool awaitingApproval;

  /// The name the comment is shown under: the credited name for a creator,
  /// because that is the name a reader knows the work by, and the account's
  /// otherwise.
  String get displayName => creatorName.isNotEmpty ? creatorName : authorName;

  /// The same comment credited to the reader who wrote it.
  ///
  /// `ListMyEpisodeComments` does not repeat the caller's own name or icon
  /// back to them, so the app names them from the session it holds and the
  /// row then renders among the public ones without a case of its own. The
  /// icon matters as much as the name: a published comment staff take down
  /// moves from the public list to this one, and it has to look the same
  /// after the move as before it.
  EpisodeComment byAuthor({
    required String id,
    required String name,
    required Uri? iconUrl,
  }) {
    return EpisodeComment(
      id: this.id,
      body: body,
      createdAt: createdAt,
      authorId: id,
      authorName: name,
      authorIconUrl: iconUrl,
      imageRequestHeaders: imageRequestHeaders,
      creatorName: creatorName,
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
