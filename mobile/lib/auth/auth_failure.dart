/// Why a sign-in, a sign-up, a password reset, or a session check did not
/// produce what the screen asked for.
enum AuthFailureKind {
  /// The email and password pair was rejected.
  invalidCredentials,

  /// The account exists but has not confirmed its email address yet, so the
  /// reader opens the link in the confirmation email before signing in.
  emailNotVerified,

  /// The API no longer accepts the token the app had stored, so the reader
  /// signs in again.
  sessionExpired,

  /// The API would not take what the form sent — an address that is not one,
  /// a birth date that is not a past calendar date, or a current password that
  /// is not the account's. The form is the only place that can say which field
  /// it was.
  invalidInput,

  /// The API would not take the birth date as a past calendar date.
  birthDateInvalid,

  /// The account already holds a birth date, which is written only once.
  birthDateAlreadySet,

  /// The caller has asked for more mail than the allowance covers, so the
  /// reader waits rather than trying again straight away.
  rateLimited,

  /// The token an emailed link carried — a confirmation link or a password
  /// reset link — is not one the API issued.
  linkInvalid,

  /// The emailed link was issued, but its time has run out, so the reader
  /// asks for a fresh one.
  linkExpired,

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
