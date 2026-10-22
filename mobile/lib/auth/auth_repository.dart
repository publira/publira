import 'package:publira/auth/account_icon.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/reader_icon_policy.dart';
import 'package:publira/auth/sign_up_requirements.dart';

/// Sign-up, sign-in, password reset, session checks, and the signed-in
/// reader's own account settings against the public API.
abstract class AuthRepository {
  /// Signs [email] in with [password] and returns the session the API issued.
  ///
  /// Throws [AuthFailure].
  Future<AuthSession> signIn({required String email, required String password});

  /// The providers the tenant lets a reader sign in with, read without a
  /// session.
  ///
  /// Throws [AuthFailure].
  Future<SignInProviders> readSignInProviders();

  /// Signs in with the token a provider issued, which finds the account
  /// already linked to it, links the account holding the address it vouches
  /// for, or creates one.
  ///
  /// [birthDate] and [agreedPageVersionIds] are read only when this creates
  /// the account, and mean what they mean for [signUp].
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.consentRequired] leaves the token
  /// unspent, so it is sent again with the consent.
  Future<AuthSession> signInWithProvider(
    ProviderCredential credential, {
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
  });

  /// The provider accounts linked to the reader behind [session].
  ///
  /// Throws [AuthFailure].
  Future<LinkedIdentities> readLinkedIdentities(AuthSession session);

  /// Unlinks [provider] from the account behind [session].
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.lastSignInMethod] where it is the
  /// last way an account without a password or a passkey signs in.
  Future<void> unlinkIdentity(AuthSession session, IdentityProvider provider);

  /// Links the provider account [credential] is a fresh sign-in to, to the
  /// account behind [session], whatever address the provider carries, so it
  /// signs in to that account from then on.
  ///
  /// Throws [AuthFailure]: [AuthFailureKind.linkedToAnotherAccount] where the
  /// provider account signs in to another reader,
  /// [AuthFailureKind.providerAlreadyLinked] where the account has one of that
  /// provider linked, [AuthFailureKind.invalidInput] for a sign-in the API
  /// could not verify, and [AuthFailureKind.providerRefused] where the tenant
  /// no longer offers the provider.
  Future<void> linkIdentity(AuthSession session, ProviderCredential credential);

  /// Begins a sign-in with a passkey alone and returns the
  /// `PublicKeyCredentialRequestOptionsJSON` the authenticator signs, which
  /// names no account: the passkey the reader picks does.
  ///
  /// Throws [AuthFailure].
  Future<String> beginPasskeySignIn();

  /// Signs in with [credentialJson], the assertion the authenticator made over
  /// the challenge [beginPasskeySignIn] began, and returns the session the API
  /// issued.
  ///
  /// Throws [AuthFailure]: [AuthFailureKind.invalidCredentials] for a passkey
  /// the site does not take, as for a wrong password, and
  /// [AuthFailureKind.emailNotVerified] for an account [signIn] refuses the
  /// same way.
  Future<AuthSession> signInWithPasskey(String credentialJson);

  /// The passkeys of the reader behind [session], oldest first.
  ///
  /// Throws [AuthFailure].
  Future<List<Passkey>> readPasskeys(AuthSession session);

  /// Begins registering a passkey for the reader behind [session] and returns
  /// the `PublicKeyCredentialCreationOptionsJSON` the authenticator makes it
  /// over.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.passkeyLimit] once the account
  /// holds as many as it may.
  Future<String> beginPasskeyRegistration(AuthSession session);

  /// Stores [credentialJson], the passkey the authenticator made over the
  /// options [beginPasskeyRegistration] answered, unnamed.
  ///
  /// Throws [AuthFailure]: [AuthFailureKind.passkeyAlreadyRegistered] where
  /// the tenant holds it already, [AuthFailureKind.passkeyLimit] where the
  /// account filled up meanwhile, and [AuthFailureKind.invalidInput] for a
  /// credential that does not verify.
  Future<Passkey> finishPasskeyRegistration(
    AuthSession session,
    String credentialJson,
  );

  /// Names the reader's passkey [id] [name], or leaves it unnamed where
  /// [name] is empty.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.passkeyNotFound] for one that is
  /// no longer the reader's.
  Future<Passkey> renamePasskey(AuthSession session, String id, String name);

  /// Removes the reader's passkey [id], which stops signing them in. One
  /// removed already is answered as removed.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.lastSignInMethod] where it is the
  /// last way an account without a password or a linked provider signs in.
  Future<void> deletePasskey(AuthSession session, String id);

  /// Begins the assertion that confirms [requestEmailChangeWithPasskey] or
  /// [deleteAccountWithPasskey] for the reader behind [session], and returns
  /// the `PublicKeyCredentialRequestOptionsJSON` the authenticator signs,
  /// which allows that reader's passkeys alone.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.passkeyNotFound] where the reader
  /// holds no passkey any more, removed from another device or the site since
  /// the screen read the account.
  Future<String> beginPasskeyConfirmation(AuthSession session);

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
  /// Each page is read in its translation in [locale], else the tenant's
  /// default locale, else its oldest published one, so the version agreed to
  /// is the text the reader was offered.
  ///
  /// Throws [AuthFailure].
  Future<SignUpRequirements> readSignUpRequirements({required String locale});

  /// The pages the reader behind [session] has still to agree to: the
  /// tenant's terms of service and privacy policy where a version published
  /// since they last agreed asks every reader again. Empty when they owe
  /// nothing.
  ///
  /// Each page is read in its translation in [locale], as
  /// [readSignUpRequirements] reads it, so the version agreed to is the text
  /// the reader was offered.
  ///
  /// Throws [AuthFailure].
  Future<List<LegalPage>> readOwedLegalPages(
    AuthSession session, {
    required String locale,
  });

  /// Records that the reader behind [session] agreed to
  /// [agreedPageVersionIds], the versions [readOwedLegalPages] offered, and
  /// returns the pages they still owe afterwards, read in [locale]: none once
  /// the agreement settles them, and the page again where a version was
  /// published since it was read.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.invalidInput] where a version is
  /// not one the tenant asks about any longer.
  Future<List<LegalPage>> agreeToLegalPages(
    AuthSession session, {
    required List<String> agreedPageVersionIds,
    required String locale,
  });

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

  /// Which notifications the account behind [session] takes, by email and
  /// per category and channel: the settings the storefront's notification
  /// settings read and write as well.
  ///
  /// Throws [AuthFailure].
  Future<NotificationSettings> readNotificationSettings(AuthSession session);

  /// Writes [emailEnabled] and [cells] to the account behind [session] in one
  /// request and returns what the account then holds. A cell [cells] leaves
  /// out keeps what the account holds; email is written on every request,
  /// because the API takes it on every one.
  ///
  /// Throws [AuthFailure].
  Future<NotificationSettings> updateNotificationSettings(
    AuthSession session, {
    required bool emailEnabled,
    Map<NotificationCell, bool> cells = const {},
  });

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

  /// Makes [upload] the icon of the account behind [session], replacing the
  /// one it showed, and returns the session carrying the icon the account
  /// then shows.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.iconRefused] for an image
  /// the API would not make an icon of.
  Future<AuthSession> uploadIcon(AuthSession session, AccountIconUpload upload);

  /// Shows the tenant's preset [presetId] as the icon of the account behind
  /// [session], in place of the one it showed, and returns the session
  /// carrying it.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.iconPresetUnavailable] for a
  /// preset the tenant no longer holds.
  Future<AuthSession> selectIcon(AuthSession session, String presetId);

  /// Leaves the account behind [session] with no icon and returns the session
  /// carrying none.
  ///
  /// Throws [AuthFailure].
  Future<AuthSession> removeIcon(AuthSession session);

  /// What the tenant lets its readers show as an icon.
  ///
  /// Throws [AuthFailure].
  Future<ReaderIconChoice> readIconChoice();

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

  /// [requestEmailChange] for an account without a password, confirmed by a
  /// fresh sign-in with a provider linked to it.
  ///
  /// Throws [AuthFailure]; a token of another account and an address another
  /// account holds are both [AuthFailureKind.invalidInput].
  Future<void> requestEmailChangeWithProvider(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required ProviderCredential credential,
  });

  /// [requestEmailChange] for an account without a password, confirmed by
  /// [credentialJson], the assertion one of its passkeys made over the
  /// challenge [beginPasskeyConfirmation] began.
  ///
  /// Throws [AuthFailure]: [AuthFailureKind.passkeyRefused] for an assertion
  /// the API does not take, and [AuthFailureKind.invalidInput] for an address
  /// another account holds.
  Future<void> requestEmailChangeWithPasskey(
    AuthSession session, {
    required String currentEmail,
    required String newEmail,
    required String credentialJson,
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

  /// Deletes the account behind [session], which has no password, once a
  /// fresh sign-in with a provider linked to it confirms it is the reader
  /// asking.
  ///
  /// Throws [AuthFailure]; a token of another account is
  /// [AuthFailureKind.invalidInput].
  Future<void> deleteAccountWithProvider(
    AuthSession session,
    ProviderCredential credential,
  );

  /// Deletes the account behind [session], which has no password, once
  /// [credentialJson], the assertion one of its passkeys made over the
  /// challenge [beginPasskeyConfirmation] began, confirms it is the reader
  /// asking.
  ///
  /// Throws [AuthFailure]; [AuthFailureKind.passkeyRefused] for an assertion
  /// the API does not take.
  Future<void> deleteAccountWithPasskey(
    AuthSession session,
    String credentialJson,
  );

  /// Tells the API the reader behind [session] has signed out, which it
  /// records in its audit trail. The token is stateless, so nothing else
  /// changes on either side.
  ///
  /// Throws [AuthFailure].
  Future<void> signOut(AuthSession session);
}
