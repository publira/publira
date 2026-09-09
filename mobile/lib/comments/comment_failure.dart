/// Why a comment read or a comment the reader submitted did not go through.
enum CommentFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`. Comments are
  /// online only, so this is also what an episode read from the device reports
  /// when its comments are asked for.
  network,

  /// The API no longer accepts the token the app holds, so the reader signs in
  /// again before their comment can be taken.
  sessionExpired,

  /// The reader has posted or reported too often in too short a time.
  rateLimited,

  /// The API refused what was submitted: a body over the limit, or a token
  /// that names no page.
  rejected,

  /// The reader may not do this: commenting is off, the episode body is not
  /// theirs to read, or the comment is their own to delete rather than report.
  notAllowed,

  /// The comment or the episode is not there any more, which is what a comment
  /// deleted from another device answers.
  gone,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed comment call. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class CommentFailure implements Exception {
  const CommentFailure(this.kind, {this.message = ''});

  final CommentFailureKind kind;
  final String message;

  @override
  String toString() => 'CommentFailure($kind, $message)';
}
