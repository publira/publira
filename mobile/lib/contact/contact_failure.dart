/// Why a message the reader sent to the tenant was not accepted.
enum ContactFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// Connect `invalid_argument`: the API refused what the form held, which a
  /// form that checks the same limits only sees for an address it could not
  /// judge.
  invalid,

  /// Connect `resource_exhausted`: the reader or their client has sent as many
  /// messages as the API allows for now.
  rateLimited,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed contact submission. [kind] is what the UI switches on; [message]
/// is diagnostic only and must not be shown as user-facing copy.
class ContactFailure implements Exception {
  const ContactFailure(this.kind, {this.message = ''});

  final ContactFailureKind kind;
  final String message;

  @override
  String toString() => 'ContactFailure($kind, $message)';
}
