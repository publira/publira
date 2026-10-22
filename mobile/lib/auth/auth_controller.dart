import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:publira/auth/account_icon.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/reader_icon_policy.dart';
import 'package:publira/auth/session_store.dart';
import 'package:publira/auth/sign_up_requirements.dart';

/// Holds the signed-in reader for the whole app and keeps [SessionStore] in
/// step with it.
///
/// Everything that authorizes a request reads [accessToken] from here, so a
/// sign-in or a sign-out reaches the next API and image request without any
/// other wiring.
class AuthController extends ChangeNotifier {
  AuthController({
    required this._repository,
    required this._store,
    this._session,
    this.imageRequestHeaders = const {},
  });

  final AuthRepository _repository;
  final SessionStore _store;

  /// Headers a request for an image served to every reader alike carries: the
  /// signed-in reader's icon, and the covers drawn from what the device saved,
  /// which keeps no headers of its own.
  ///
  /// Only the tenant travels, as it does for a series eye-catch.
  final Map<String, String> imageRequestHeaders;

  AuthSession? _session;

  /// Bumped by every change to [_session]. An in-flight call compares it
  /// against what it read before its await to tell whether the session it was
  /// working on is still the one in hand — two sessions can be equal, or even
  /// the same object, so the count is what makes the check reliable.
  var _revision = 0;

  /// Bumped only when the reader in hand changes — a sign-in, a sign-out, an
  /// expiry — and not when the same reader's session is renamed or re-keyed,
  /// so a settings change still lands after another one has finished.
  var _reader = 0;
  var _expired = false;

  AuthSession? get session => _session;

  bool get isSignedIn => _session != null;

  /// The JWT to send with an API or image request. Empty when signed out.
  String get accessToken => _session?.accessToken ?? '';

  /// Set once a stored session turned out to be gone, so the app can tell the
  /// reader why they are signed out and offer the way back in. Read it with
  /// [acknowledgeExpiry], which clears it.
  bool get expired => _expired;

  /// Brings back a stored session at launch and confirms with
  /// `AuthService/GetMe` that the API still accepts it.
  ///
  /// A rejected token is dropped and [expired] tells the reader so, with the
  /// sign-in screen one tap away, but an unreachable API is not treated as a
  /// rejection: a launch without a network keeps the session so the reader is
  /// still signed in once they are back on one.
  ///
  /// The app is already interactive while the check is in flight, so its
  /// answer only counts as long as [stored] is still the session in hand. A
  /// reader who signs out or signs in again in the meantime has said something
  /// newer than the API has, and the late answer is dropped.
  Future<void> restore() async {
    final stored = await _store.read();
    if (stored == null) {
      return;
    }
    if (stored.hasExpired(DateTime.now())) {
      await _expire();
      return;
    }
    _setSession(stored);
    final revision = _revision;
    notifyListeners();
    try {
      final refreshed = await _repository.refresh(stored);
      if (_revision != revision) {
        return;
      }
      _setSession(refreshed, sameReader: true);
      await _store.write(refreshed);
      notifyListeners();
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthFailureKind.sessionExpired &&
          _revision == revision) {
        await _expire();
      }
    }
  }

  /// Throws [AuthFailure] and leaves the current session alone when the API
  /// turns the credentials down.
  Future<void> signIn({required String email, required String password}) async {
    await _adopt(await _repository.signIn(email: email, password: password));
  }

  /// The providers the tenant lets a reader sign in with.
  ///
  /// Throws [AuthFailure].
  Future<SignInProviders> readSignInProviders() =>
      _repository.readSignInProviders();

  /// Signs in with the token a provider issued, the way [signIn] does with a
  /// password. [birthDate] and [agreedPageVersionIds] count only where this
  /// creates the account.
  ///
  /// Throws [AuthFailure] and leaves the current session alone;
  /// [AuthFailureKind.consentRequired] asks for the consent and the same
  /// [credential] again.
  Future<void> signInWithProvider(
    ProviderCredential credential, {
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
  }) async {
    await _adopt(
      await _repository.signInWithProvider(
        credential,
        birthDate: birthDate,
        agreedPageVersionIds: agreedPageVersionIds,
      ),
    );
  }

  /// Signs in with one of the reader's passkeys, which [authenticator] asks
  /// them for over a challenge the API begins, the way [signIn] does with a
  /// password.
  ///
  /// `AuthService/BeginPasskeyLogin` answers options that name no account,
  /// the system's sheet offers whichever passkey the reader holds for the
  /// tenant host — on the device, in iCloud Keychain or Google Password
  /// Manager, or on another device — and `AuthService/FinishPasskeyLogin`
  /// signs in with the one they pick.
  ///
  /// Throws [PasskeyCancelled] or [PasskeyFailure] from [authenticator], and
  /// [AuthFailure] from the API, and leaves the current session alone.
  Future<void> signInWithPasskey(PasskeyAuthenticator authenticator) async {
    final options = await _repository.beginPasskeySignIn();
    final credential = await authenticator.authenticate(options);
    await _adopt(await _repository.signInWithPasskey(credential));
  }

  Future<void> _adopt(AuthSession session) async {
    await _store.write(session);
    _setSession(session);
    _expired = false;
    notifyListeners();
  }

  /// The provider accounts linked to the signed-in reader.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in, and signs out on a token the API has stopped accepting.
  Future<LinkedIdentities> readLinkedIdentities() async {
    final session = _requireSession();
    return _whileHeld(() => _repository.readLinkedIdentities(session));
  }

  /// Unlinks [provider] from the signed-in account.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> unlinkIdentity(IdentityProvider provider) async {
    final session = _requireSession();
    await _whileHeld(() => _repository.unlinkIdentity(session, provider));
  }

  /// Links the provider account [credential] is a fresh sign-in to, to the
  /// signed-in account.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> linkIdentity(ProviderCredential credential) async {
    final session = _requireSession();
    await _whileHeld(() => _repository.linkIdentity(session, credential));
  }

  /// The signed-in reader's passkeys, oldest first.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in, and signs out on a token the API has stopped accepting.
  Future<List<Passkey>> readPasskeys() async {
    final session = _requireSession();
    return _whileHeld(() => _repository.readPasskeys(session));
  }

  /// Registers a passkey for the signed-in reader, which [authenticator] asks
  /// them to make, and returns it unnamed.
  ///
  /// Throws [PasskeyCancelled], [PasskeyAlreadyRegistered], or
  /// [PasskeyFailure] from [authenticator], and [AuthFailure] from the API,
  /// with [AuthFailureKind.sessionExpired] when nobody is signed in.
  Future<Passkey> registerPasskey(PasskeyAuthenticator authenticator) async {
    final session = _requireSession();
    return _whileHeld(() async {
      final options = await _repository.beginPasskeyRegistration(session);
      final credential = await authenticator.register(options);
      return _repository.finishPasskeyRegistration(session, credential);
    });
  }

  /// Names the signed-in reader's passkey [id] [name], or leaves it unnamed
  /// where [name] is empty.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<Passkey> renamePasskey(String id, String name) async {
    final session = _requireSession();
    return _whileHeld(() => _repository.renamePasskey(session, id, name));
  }

  /// Removes the signed-in reader's passkey [id].
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> deletePasskey(String id) async {
    final session = _requireSession();
    await _whileHeld(() => _repository.deletePasskey(session, id));
  }

  /// Asks for an account, which the API answers by mailing a confirmation
  /// link. Nothing here signs anybody in: the reader opens that link and then
  /// signs in, and a session the app already holds is left alone.
  ///
  /// Throws [AuthFailure].
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
    List<String> agreedPageVersionIds = const [],
  }) {
    return _repository.signUp(
      name: name,
      email: email,
      password: password,
      birthDate: birthDate,
      agreedPageVersionIds: agreedPageVersionIds,
    );
  }

  /// Confirms the address behind a confirmation link's [token].
  ///
  /// Throws [AuthFailure].
  Future<void> verifyEmail(String token) => _repository.verifyEmail(token);

  /// Asks for a fresh confirmation link to [email].
  ///
  /// Throws [AuthFailure].
  Future<void> requestEmailVerification(String email) =>
      _repository.requestEmailVerification(email);

  /// Asks for a link to set a new password with, mailed to [email].
  ///
  /// Throws [AuthFailure].
  Future<void> requestPasswordReset(String email) =>
      _repository.requestPasswordReset(email);

  /// Sets [newPassword] on the account behind a reset link's [token].
  ///
  /// The API ends every session of that account, so a session this device
  /// holds is checked with `AuthService/GetMe` afterwards and dropped once the
  /// API refuses it. The link does not say whose account it was for, and a
  /// session of another account is still good. The reader is not told the
  /// session expired: they have just replaced the password it was signed in
  /// with.
  ///
  /// Throws [AuthFailure] when the reset itself fails. The check that follows
  /// never throws; a session it could not settle is left for the next launch
  /// to confirm.
  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    await _repository.confirmPasswordReset(
      token: token,
      newPassword: newPassword,
    );
    final session = _session;
    if (session == null) {
      return;
    }
    final revision = _revision;
    try {
      await _repository.refresh(session);
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthFailureKind.sessionExpired &&
          _revision == revision) {
        await _drop(expired: false);
      }
    }
  }

  /// Whether the tenant checks ages and which pages it asks consent to, which
  /// the sign-up form reads before it decides what to offer.
  ///
  /// Throws [AuthFailure].
  Future<SignUpRequirements> readSignUpRequirements({required String locale}) =>
      _repository.readSignUpRequirements(locale: locale);

  /// The pages the signed-in reader has still to agree to, read in [locale];
  /// empty when nobody is signed in.
  ///
  /// Throws [AuthFailure], and signs out on a token the API has stopped
  /// accepting, the way [readReaderAge] does.
  Future<List<LegalPage>> readOwedLegalPages({required String locale}) async {
    final session = _session;
    if (session == null) {
      return const [];
    }
    return _whileHeld(
      () => _repository.readOwedLegalPages(session, locale: locale),
    );
  }

  /// Records the signed-in reader's agreement to [agreedPageVersionIds] and
  /// returns the pages they still owe, read in [locale].
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<List<LegalPage>> agreeToLegalPages(
    List<String> agreedPageVersionIds, {
    required String locale,
  }) async {
    final session = _requireSession();
    return _whileHeld(
      () => _repository.agreeToLegalPages(
        session,
        agreedPageVersionIds: agreedPageVersionIds,
        locale: locale,
      ),
    );
  }

  /// The signed-in reader's birth date and the tenant rule it is read
  /// against, or `null` when nobody is signed in.
  ///
  /// Throws [AuthFailure]. A token the API has stopped accepting also signs
  /// the reader out, so a screen asking for a date is not left standing on an
  /// account they no longer hold.
  Future<ReaderAge?> readReaderAge() async {
    final session = _session;
    if (session == null) {
      return null;
    }
    return _whileHeld(() => _repository.readReaderAge(session));
  }

  /// The signed-in account's email address, or `null` when nobody is signed
  /// in.
  ///
  /// Throws [AuthFailure], and signs out on a token the API has stopped
  /// accepting, the way [readReaderAge] does.
  Future<String?> readEmail() async {
    final session = _session;
    if (session == null) {
      return null;
    }
    return _whileHeld(() => _repository.readEmail(session));
  }

  /// Which notifications the signed-in account takes, or `null` when nobody
  /// is signed in.
  ///
  /// Throws [AuthFailure], and signs out on a token the API has stopped
  /// accepting, the way [readReaderAge] does.
  Future<NotificationSettings?> readNotificationSettings() async {
    final session = _session;
    if (session == null) {
      return null;
    }
    return _whileHeld(() => _repository.readNotificationSettings(session));
  }

  /// Writes [cells] over [current], the settings the reader was shown, to
  /// the signed-in account in one request and returns what it then holds.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<NotificationSettings> updateNotificationSettings({
    required NotificationSettings current,
    Map<NotificationCell, bool> cells = const {},
  }) async {
    final session = _requireSession();
    return _whileHeld(
      () => _repository.updateNotificationSettings(
        session,
        current: current,
        cells: cells,
      ),
    );
  }

  /// Records [birthDate] on the signed-in account and returns the date it
  /// then holds.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<String> recordBirthDate(DateTime birthDate) async {
    final session = _requireSession();
    return _whileHeld(() => _repository.recordBirthDate(session, birthDate));
  }

  /// Renames the signed-in account, so the account screen shows the new name
  /// without another round trip.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> updateName(String name) => _replaceSession(
    (session) => _repository.updateName(session, name),
    (current, renamed) => current.withUser(
      userPublicId: current.userPublicId,
      userName: renamed.userName,
      userIconUrl: current.userIconUrl,
      userIconPresetId: current.userIconPresetId,
    ),
  );

  /// Makes [upload] the signed-in account's icon, so every screen that draws
  /// the reader shows the new one without another round trip.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> uploadIcon(AccountIconUpload upload) => _replaceSession(
    (session) => _repository.uploadIcon(session, upload),
    _withIconOf,
  );

  /// Shows the tenant's preset [presetId] as the signed-in account's icon, so
  /// every screen that draws the reader shows it without another round trip.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> selectIcon(String presetId) => _replaceSession(
    (session) => _repository.selectIcon(session, presetId),
    _withIconOf,
  );

  /// Leaves the signed-in account with no icon, so every screen that draws
  /// the reader shows the fallback.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> removeIcon() =>
      _replaceSession(_repository.removeIcon, _withIconOf);

  /// [current] carrying the icon [changed] answers with and nothing else of
  /// it.
  ///
  /// Every answer that changes the account carries all of it, so a change
  /// takes only the field it made: a rename that lands after an icon upload
  /// would otherwise put back the icon it was answered with, whose URL has
  /// stopped answering, and an upload that lands after a rename the name it
  /// was sent under.
  AuthSession _withIconOf(AuthSession current, AuthSession changed) =>
      current.withUser(
        userPublicId: current.userPublicId,
        userName: current.userName,
        userIconUrl: changed.userIconUrl,
        userIconPresetId: changed.userIconPresetId,
      );

  /// What the tenant lets its readers show as an icon.
  ///
  /// Throws [AuthFailure].
  Future<ReaderIconChoice> readIconChoice() => _repository.readIconChoice();

  /// Replaces the signed-in account's password and holds on to the token the
  /// API hands back, because the change ends the one this device had.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) => _replaceSession(
    (session) => _repository.changePassword(
      session,
      currentPassword: currentPassword,
      newPassword: newPassword,
    ),
    (current, rekeyed) => current.withAccessToken(
      rekeyed.accessToken,
      expiresAt: rekeyed.expiresAt,
    ),
  );

  /// Asks to move the signed-in account from [currentEmail] to [newEmail].
  /// Nothing changes until both mailed links have been opened.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<void> requestEmailChange({
    required String currentEmail,
    required String newEmail,
    required String currentPassword,
  }) async {
    final session = _requireSession();
    await _whileHeld(
      () => _repository.requestEmailChange(
        session,
        currentEmail: currentEmail,
        newEmail: newEmail,
        currentPassword: currentPassword,
      ),
    );
  }

  /// [requestEmailChange] for an account without a password, confirmed by a
  /// fresh sign-in with a provider linked to it.
  Future<void> requestEmailChangeWithProvider({
    required String currentEmail,
    required String newEmail,
    required ProviderCredential credential,
  }) async {
    final session = _requireSession();
    await _whileHeld(
      () => _repository.requestEmailChangeWithProvider(
        session,
        currentEmail: currentEmail,
        newEmail: newEmail,
        credential: credential,
      ),
    );
  }

  /// [requestEmailChange] for an account without a password, confirmed with
  /// one of its passkeys, which [authenticator] asks the reader for over a
  /// challenge the API begins.
  ///
  /// Throws [PasskeyCancelled] or [PasskeyFailure] from [authenticator], and
  /// [AuthFailure] from the API, with [AuthFailureKind.sessionExpired] when
  /// nobody is signed in.
  Future<void> requestEmailChangeWithPasskey({
    required String currentEmail,
    required String newEmail,
    required PasskeyAuthenticator authenticator,
  }) async {
    final session = _requireSession();
    await _whileHeld(() async {
      final credential = await authenticator.authenticate(
        await _repository.beginPasskeyConfirmation(session),
      );
      await _repository.requestEmailChangeWithPasskey(
        session,
        currentEmail: currentEmail,
        newEmail: newEmail,
        credentialJson: credential,
      );
    });
  }

  /// Spends one of an email change's two links. The session carries no
  /// address, so whichever one is held stays as it is.
  ///
  /// Throws [AuthFailure].
  Future<EmailChangeProgress> confirmEmailChange(String token) =>
      _repository.confirmEmailChange(token);

  /// Deletes the signed-in account and drops the session it was held with,
  /// so nothing is left signed in to an account that no longer exists.
  ///
  /// Throws [AuthFailure] and keeps the session when the API refuses, such as
  /// for a wrong [password]. Once the API has deleted the account the session
  /// is dropped even if the credential store refuses to forget it: the token
  /// it keeps is refused at the next launch, while one kept in hand would go
  /// on presenting an account that is gone.
  Future<void> deleteAccount({required String password}) => _deleteAccount(
    (session) => _repository.deleteAccount(session, password: password),
  );

  /// [deleteAccount] for an account without a password, confirmed by a fresh
  /// sign-in with a provider linked to it.
  Future<void> deleteAccountWithProvider(ProviderCredential credential) =>
      _deleteAccount(
        (session) => _repository.deleteAccountWithProvider(session, credential),
      );

  /// [deleteAccount] for an account without a password, confirmed with one
  /// of its passkeys, which [authenticator] asks the reader for over a
  /// challenge the API begins.
  ///
  /// Throws [PasskeyCancelled] or [PasskeyFailure] from [authenticator] as
  /// well, and keeps the session for each.
  Future<void> deleteAccountWithPasskey(PasskeyAuthenticator authenticator) =>
      _deleteAccount((session) async {
        final credential = await authenticator.authenticate(
          await _repository.beginPasskeyConfirmation(session),
        );
        await _repository.deleteAccountWithPasskey(session, credential);
      });

  Future<void> _deleteAccount(
    Future<void> Function(AuthSession session) delete,
  ) async {
    final session = _requireSession();
    final reader = _reader;
    await _whileHeld(() => delete(session));
    if (_reader != reader) {
      return;
    }
    _setSession(null);
    _expired = false;
    notifyListeners();
    try {
      await _store.clear();
    } on Object {
      // Settled at the next launch, when the stored token is refused.
    }
  }

  AuthSession _requireSession() {
    final session = _session;
    if (session == null) {
      throw const AuthFailure(AuthFailureKind.sessionExpired);
    }
    return session;
  }

  /// Runs [call] on the session in hand and folds what it returns into the
  /// session in hand by then with [merge], unless the reader signed out or in
  /// again while it was in flight.
  ///
  /// Merging rather than replacing lets two changes to the same reader finish
  /// in either order: a rename that lands after a password change keeps the
  /// new token, and the new token keeps the new name.
  ///
  /// The replacement is held before it is stored, so a keychain that refuses
  /// it still leaves this run working with the token the API now accepts.
  Future<void> _replaceSession(
    Future<AuthSession> Function(AuthSession session) call,
    AuthSession Function(AuthSession current, AuthSession returned) merge,
  ) async {
    final session = _requireSession();
    final reader = _reader;
    final returned = await _whileHeld(() => call(session));
    final current = _session;
    if (_reader != reader || current == null) {
      return;
    }
    final replaced = merge(current, returned);
    _setSession(replaced, sameReader: true);
    notifyListeners();
    await _store.write(replaced);
  }

  /// Runs [call], and signs out when the API rejects the token while that
  /// session is still the one in hand.
  Future<T> _whileHeld<T>(Future<T> Function() call) async {
    final revision = _revision;
    try {
      return await call();
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthFailureKind.sessionExpired &&
          _revision == revision) {
        await _expire();
      }
      rethrow;
    }
  }

  /// Drops the session in hand and the one [SessionStore] kept, so a paid
  /// episode goes back to its locked state, and tells the API without
  /// waiting, so the sign-out is audited the way one on the website is. The
  /// token is stateless, so nothing depends on the API hearing of it.
  Future<void> signOut() async {
    final session = _session;
    if (session != null) {
      unawaited(_recordSignOut(session));
    }
    await _drop(expired: false);
  }

  Future<void> _recordSignOut(AuthSession session) async {
    try {
      await _repository.signOut(session);
    } on Object {
      // The session is already gone on this device.
    }
  }

  /// Reads and clears [expired], so the reader is told once rather than on
  /// every rebuild.
  bool acknowledgeExpiry() {
    final expired = _expired;
    _expired = false;
    return expired;
  }

  Future<void> _expire() => _drop(expired: true);

  Future<void> _drop({required bool expired}) async {
    await _store.clear();
    _setSession(null);
    _expired = expired;
    notifyListeners();
  }

  void _setSession(AuthSession? session, {bool sameReader = false}) {
    _session = session;
    _revision++;
    if (!sameReader) {
      _reader++;
    }
  }
}
