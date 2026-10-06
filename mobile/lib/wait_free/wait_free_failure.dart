/// Why a wait-for-free call did not go through.
enum WaitFreeFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API no longer accepts the token the app holds, or the app holds
  /// none, so the reader signs in again before a ticket is theirs to use.
  sessionExpired,

  /// The series does not offer the rule, which a series that turned it off
  /// after the screen read it answers.
  notOffered,

  /// The reader's next ticket is not ready yet.
  notRecharged,

  /// The episode is one of the latest ones the rule keeps a ticket off.
  excluded,

  /// The episode is free to everyone right now, so there is nothing to spend
  /// a ticket on.
  episodeFree,

  /// The reader can already open the episode: bought, a ticket on it that has
  /// not expired, or a credit on it.
  alreadyOpen,

  /// The episode or its series is not shown here any more, or the tenant's
  /// age rule stops this reader from opening it.
  gone,

  /// The reader asked more often than the platform allows.
  tooManyRequests,

  /// Anything else.
  unexpected,
}

/// A failed wait-for-free call. [kind] is what the UI switches on; [message]
/// is diagnostic only and must not be shown as user-facing copy.
class WaitFreeFailure implements Exception {
  const WaitFreeFailure(this.kind, {this.message = ''});

  final WaitFreeFailureKind kind;
  final String message;

  @override
  String toString() => 'WaitFreeFailure($kind, $message)';
}
