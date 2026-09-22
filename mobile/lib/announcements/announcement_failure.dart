/// Why an announcement read or a read mark did not go through.
enum AnnouncementFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`. The
  /// announcements are online only, so this is also what a device without a
  /// network reports.
  network,

  /// The API no longer accepts the token the app holds.
  sessionExpired,

  /// The announcement does not exist, or is not one this reader is shown.
  notFound,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed announcement call. [kind] is what the UI switches on; [message]
/// is diagnostic only and must not be shown as user-facing copy.
class AnnouncementFailure implements Exception {
  const AnnouncementFailure(this.kind, {this.message = ''});

  final AnnouncementFailureKind kind;
  final String message;

  @override
  String toString() => 'AnnouncementFailure($kind, $message)';
}
