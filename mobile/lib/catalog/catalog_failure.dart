/// Why a catalog read did not produce data.
enum CatalogFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

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
