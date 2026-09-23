import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/sign_up_requirements.dart';

/// Sign-up, sign-in, password reset, session checks, and the signed-in
/// reader's own account settings against the public API.
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
  /// not make ask. [agreedPageVersionIds] are the versions of the pages the
  /// reader agreed to, empty where the tenant names none.
  ///
  /// Throws [AuthFailure].
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
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

  /// Whether the tenant checks ages and which pages it asks consent to, read
  /// without a session and in one tenant read, so the sign-up form knows
  /// whether to ask for a birth date and for consent.
  ///
  /// Throws [AuthFailure].
  Future<SignUpRequirements> readSignUpRequirements();

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

  /// Renames the account behind [session] to [name] and returns the session
  /// carrying the name the account then holds.
  ///
  /// Throws [AuthFailure].
  Future<AuthSession> updateName(AuthSession session, String name);

  /// Replaces the password of the account behind [session] and returns the
  /// session to keep.
  ///
  /// The API ends every token minted before the change, [session]'s included,
  /// and hands back a replacement so the device that made the change stays
  /// signed in while every other one has to sign in again.
  ///
  /// Throws [AuthFailure]; a wrong [currentPassword] is
  /// [AuthFailureKind.invalidInput], not a rejected session.
  Future<AuthSession> changePassword(
    AuthSession session, {
    required String currentPassword,
    required String newPassword,
  });

  /// Asks to move the account behind [session] from [currentEmail] to
  /// [newEmail], which the API answers by mailing a confirmation link to each.
  ///
  /// Throws [AuthFailure]; a wrong [currentPassword] and an address another
  /// account holds are both [AuthFailureKind.invalidInput].
  Future<void> requestEmailChange(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required String currentPassword,
  });

  /// Spends the [token] one of an email change's two links carries, which
  /// needs no session: the link may be opened on a device that holds none.
  ///
  /// Throws [AuthFailure]; the kind tells a link the API never issued from
  /// one whose time has run out or whose request has been overtaken.
  Future<EmailChangeProgress> confirmEmailChange(String token);

  /// Deletes the account behind [session], once [password] confirms it is
  /// the reader asking.
  ///
  /// Throws [AuthFailure]; a wrong [password] is
  /// [AuthFailureKind.invalidInput].
  Future<void> deleteAccount(AuthSession session, {required String password});
}
