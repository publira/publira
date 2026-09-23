/// Why a published page, or the set of them, could not be read.
enum PageFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// No page is published at the slug asked for.
  notFound,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed page read. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class PageFailure implements Exception {
  const PageFailure(this.kind, {this.message = ''});

  final PageFailureKind kind;
  final String message;

  @override
  String toString() => 'PageFailure($kind, $message)';
}
