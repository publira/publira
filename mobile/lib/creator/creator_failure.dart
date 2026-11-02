/// Why a read of the reader's own Author pages did not go through.
enum CreatorFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API no longer accepts the token the app holds, so the reader signs in
  /// again.
  sessionExpired,

  /// What was asked for is not the reader's to read: the tenant has turned the
  /// pages off or stopped showing sales, the account is not linked to the
  /// creator, or the month is not a closed one.
  unavailable,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed `CreatorService` call. [kind] is what the UI switches on;
/// [message] is diagnostic only and must not be shown as user-facing copy.
class CreatorFailure implements Exception {
  const CreatorFailure(this.kind, {this.message = ''});

  final CreatorFailureKind kind;
  final String message;

  @override
  String toString() => 'CreatorFailure($kind, $message)';
}
