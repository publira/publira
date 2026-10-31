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

  /// Connect `unauthenticated`: the API refused the session the read was
  /// sent with, so asking again with it cannot succeed.
  sessionExpired,

  /// Connect `resource_exhausted`: the API, or an edge in front of it, has
  /// answered as many reads from this client as it allows for now, and asking
  /// again before [CatalogFailure.retryAfter] has passed is refused the same
  /// way.
  rateLimited,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed catalog read. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class CatalogFailure implements Exception {
  const CatalogFailure(
    this.kind, {
    this.message = '',
    this.refused = false,
    this.reasons = const [],
    this.retryAfter,
  });

  final CatalogFailureKind kind;
  final String message;

  /// Whether the API turned down what the request asked for — an episode it
  /// does not have, a page outside it, a permission the reader lacks — which
  /// asking again cannot change. A server fault is not a refusal.
  final bool refused;

  /// The ErrorInfo reasons the API named for a refusal, which is what tells a
  /// screen why it was refused where the Connect code alone does not.
  final List<String> reasons;

  /// How long a [CatalogFailureKind.rateLimited] refusal asked the app to wait
  /// before asking again, or `null` when it named no wait.
  final Duration? retryAfter;

  @override
  String toString() => 'CatalogFailure($kind, $message)';
}
