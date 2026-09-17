/// Why a purchase call did not go through.
enum PurchaseFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API no longer accepts the token the app holds, so the reader signs in
  /// again before a checkout can start.
  sessionExpired,

  /// The reader already holds a purchase of the episode, so there is nothing
  /// to pay for and the episode opens instead.
  alreadyPurchased,

  /// The episode or its series is not public any more.
  gone,

  /// Anything else, including a tenant that has stopped taking payments.
  unexpected,
}

/// A failed purchase call. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class PurchaseFailure implements Exception {
  const PurchaseFailure(this.kind, {this.message = ''});

  final PurchaseFailureKind kind;
  final String message;

  @override
  String toString() => 'PurchaseFailure($kind, $message)';
}
