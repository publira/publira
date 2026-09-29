/// Why an inbox read or a read mark did not go through.
enum NotificationFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`. The inbox is
  /// online only, so this is also what a device without a network reports.
  network,

  /// The API no longer accepts the token the app holds.
  sessionExpired,

  /// Anything else, including Connect `internal` and a notification that is
  /// not the reader's.
  unexpected,
}

/// A failed notification call. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class NotificationFailure implements Exception {
  const NotificationFailure(this.kind, {this.message = ''});

  final NotificationFailureKind kind;
  final String message;

  @override
  String toString() => 'NotificationFailure($kind, $message)';
}
