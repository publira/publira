/// Why a follow read or a follow the reader asked for did not go through.
enum FollowFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`. What a reader
  /// follows is online only, so this is also what a series screen opened from
  /// the device reports.
  network,

  /// The API no longer accepts the token the app holds, so the reader signs in
  /// again before what they follow can change.
  sessionExpired,

  /// The target is not public any more, which is what a series unpublished
  /// since the screen opened answers.
  gone,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed follow call. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class FollowFailure implements Exception {
  const FollowFailure(this.kind, {this.message = ''});

  final FollowFailureKind kind;
  final String message;

  @override
  String toString() => 'FollowFailure($kind, $message)';
}
