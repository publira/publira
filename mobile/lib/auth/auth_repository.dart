import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/reader_age.dart';

/// Sign-up, sign-in, password reset, and session checks against the public
/// API.
abstract class AuthRepository {
  /// Signs [email] in with [password] and returns the session the API issued.
  ///
  /// Throws [AuthFailure].
  Future<AuthSession> signIn({required String email, required String password});

  /// Asks the API for an account on [email], which it answers by mailing that
  /// address a confirmation link.
  ///
  /// Nothing comes back but the acceptance: an address that already has an
  /// account is accepted the same way, and only the mailbox tells the two
  /// apart. The account cannot sign in until the link has been opened.
  ///
  /// [birthDate] is `YYYY-MM-DD`, and empty from a form the tenant's rule did
  /// not make ask.
  ///
  /// Throws [AuthFailure].
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
  });

  /// Confirms the address behind [token], which a confirmation link carries,
  /// and activates the account it belongs to.
  ///
  /// Throws [AuthFailure]; the kind tells a link the API never issued from
  /// one whose time has run out, because only the second has a way back.
  Future<void> verifyEmail(String token);

  /// Asks the API to mail [email] a fresh confirmation link.
  ///
  /// Every address is accepted, whether it has an unconfirmed account, a
  /// confirmed one, or none at all, so this reports nothing about who is
  /// registered.
  ///
  /// Throws [AuthFailure].
  Future<void> requestEmailVerification(String email);

  /// Asks the API to mail [email] a link to set a new password with.
  ///
  /// Every address is accepted, whether or not it has an account, so this
  /// reports nothing about who is registered.
  ///
  /// Throws [AuthFailure].
  Future<void> requestPasswordReset(String email);

  /// Sets [newPassword] on the account behind [token], which a password reset
  /// link carries.
  ///
  /// The API ends every session the account held, this device's included.
  ///
  /// Throws [AuthFailure]; the kind tells a link the API never issued from
  /// one whose time has run out.
  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  });

  /// Whether the tenant checks ages, read without a session so the sign-up
  /// form knows whether to ask for a birth date.
  ///
  /// Throws [AuthFailure].
  Future<AgeVerification> readAgeVerification();

  /// Re-reads the reader behind [session], so a token restored from storage is
  /// confirmed before the app presents it as signed in.
  ///
  /// Throws [AuthFailure]; the kind is [AuthFailureKind.sessionExpired] once
  /// the API has rejected the token.
  Future<AuthSession> refresh(AuthSession session);

  /// The birth date the reader behind [session] has given, with the tenant
  /// rule and calendar it is read against.
  ///
  /// Read when it is asked for rather than carried on the session, so a date
  /// recorded elsewhere is answered on what the account holds now.
  ///
  /// Throws [AuthFailure].
  Future<ReaderAge> readReaderAge(AuthSession session);

  /// The email address of the account behind [session], empty when the API
  /// sent none.
  ///
  /// Read when it is asked for rather than carried on the session, because
  /// the address can change on the website while the app stays signed in.
  ///
  /// Throws [AuthFailure].
  Future<String> readEmail(AuthSession session);

  /// Writes [birthDate] to the account behind [session] and returns the date
  /// the account then holds, as `YYYY-MM-DD`.
  ///
  /// Throws [AuthFailure].
  Future<String> recordBirthDate(AuthSession session, DateTime birthDate);
}
