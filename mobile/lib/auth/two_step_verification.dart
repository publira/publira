/// The half-finished sign-in a password, or an Apple or Google sign-in, earns
/// an account that holds an authenticator.
///
/// Only `AuthService/VerifyMfa` takes [token], and it buys one session. The
/// authenticator is the account's, so one set up on the site or in the
/// tenant's console asks for its code here too.
class MfaChallenge {
  const MfaChallenge({required this.token, required this.expiresAt});

  final String token;

  /// When the API stops taking [token], in UTC.
  final DateTime expiresAt;

  bool hasExpired(DateTime now) => !now.isBefore(expiresAt);
}

/// What `AuthService/Login` and `AuthService/LoginWithIdToken` answer an
/// account that holds an authenticator with in place of a session: the
/// password or the provider's sign-in was right, and the code is still to
/// come.
///
/// Thrown rather than returned, the way a missing consent is, because it sends
/// the reader to a screen of its own while every other caller of a sign-in
/// only ever adopts a session.
class TwoStepVerificationRequired implements Exception {
  const TwoStepVerificationRequired(this.challenge);

  final MfaChallenge challenge;

  @override
  String toString() => 'TwoStepVerificationRequired';
}

/// Whether the signed-in account holds an authenticator, wherever it was set
/// up, and what is left of its recovery codes.
class MfaStatus {
  const MfaStatus({
    required this.enabled,
    this.enabledAt,
    this.remainingRecoveryCodes = 0,
  });

  static const disabled = MfaStatus(enabled: false);

  final bool enabled;

  /// In UTC, and `null` while [enabled] is false.
  final DateTime? enabledAt;

  /// What is left of the ten recovery codes, zero while [enabled] is false.
  final int remainingRecoveryCodes;
}

/// An authenticator set up and waiting for its first code: [secret] for an
/// authenticator on this device, typed or pasted in, and [otpauthUri] for one
/// on another device, shown as a QR code.
///
/// The API answers the secret only here and only until the next start, so
/// the screen that shows it holds the only copy.
class MfaEnrollment {
  const MfaEnrollment({required this.secret, required this.otpauthUri});

  /// Base32.
  final String secret;

  /// `otpauth://totp/…`.
  final String otpauthUri;
}

/// What the code step answers beside the session: whether the code was one of
/// the recovery codes, and how many of them are left.
class MfaVerification {
  const MfaVerification({
    required this.recoveryCodeUsed,
    required this.remainingRecoveryCodes,
  });

  final bool recoveryCodeUsed;
  final int remainingRecoveryCodes;
}
