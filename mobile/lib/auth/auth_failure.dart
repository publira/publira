/// Why a sign-in or a session check did not produce a usable session.
enum AuthFailureKind {
  /// The email and password pair was rejected.
  invalidCredentials,

  /// The account exists but has not confirmed its email address yet, so the
  /// reader finishes that on the website before signing in here.
  emailNotVerified,

  /// The API no longer accepts the token the app had stored, so the reader
  /// signs in again.
  sessionExpired,

  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// Anything else, including Connect `internal`.
  unexpected,
}

/// A failed sign-in or session check. [kind] is what the UI switches on;
/// [message] is diagnostic only and must not be shown as user-facing copy.
class AuthFailure implements Exception {
  const AuthFailure(this.kind, {this.message = ''});

  final AuthFailureKind kind;
  final String message;

  @override
  String toString() => 'AuthFailure($kind, $message)';
}
