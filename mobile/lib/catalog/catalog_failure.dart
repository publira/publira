/// Why a catalog read did not produce data.
enum CatalogFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API could not be reached and the device holds nothing to read in its
  /// place, so the screen asks for a connection rather than a retry.
  notSaved,

  /// The device holds this body, but the API has not confirmed the reader's
  /// grant inside the offline grace period, so it is no longer opened.
  saveExpired,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed catalog read. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class CatalogFailure implements Exception {
  const CatalogFailure(this.kind, {this.message = ''});

  final CatalogFailureKind kind;
  final String message;

  @override
  String toString() => 'CatalogFailure($kind, $message)';
}
