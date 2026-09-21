import 'package:flutter/foundation.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/session_store.dart';

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
  });

  final AuthRepository _repository;
  final SessionStore _store;

  AuthSession? _session;

  /// Bumped by every change to [_session]. An in-flight call compares it
  /// against what it read before its await to tell whether the session it was
  /// working on is still the one in hand — two sessions can be equal, or even
  /// the same object, so the count is what makes the check reliable.
  var _revision = 0;
  var _expired = false;

  AuthSession? get session => _session;

  bool get isSignedIn => _session != null;

  /// The JWT to send with an API or image request. Empty when signed out.
  String get accessToken => _session?.accessToken ?? '';

  /// Set once a stored session turned out to be gone, so the app can tell the
  /// reader why they are signed out and offer the way back in. Read it with
  /// [acknowledgeExpiry], which clears it.
  bool get expired => _expired;

  /// Brings back a stored session and confirms the API still accepts it.
  ///
  /// A rejected token is dropped, but an unreachable API is not treated as a
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
      _setSession(refreshed);
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
    final session = await _repository.signIn(email: email, password: password);
    await _store.write(session);
    _setSession(session);
    _expired = false;
    notifyListeners();
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
  }) {
    return _repository.signUp(
      name: name,
      email: email,
      password: password,
      birthDate: birthDate,
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

  /// Whether the tenant checks ages, which the sign-up form asks before it
  /// decides whether to offer a birth date.
  ///
  /// Throws [AuthFailure].
  Future<AgeVerification> readAgeVerification() =>
      _repository.readAgeVerification();

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

  /// Records [birthDate] on the signed-in account and returns the date it
  /// then holds.
  ///
  /// Throws [AuthFailure], with [AuthFailureKind.sessionExpired] when nobody
  /// is signed in.
  Future<String> recordBirthDate(DateTime birthDate) async {
    final session = _session;
    if (session == null) {
      throw const AuthFailure(AuthFailureKind.sessionExpired);
    }
    return _whileHeld(() => _repository.recordBirthDate(session, birthDate));
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

  Future<void> signOut() async {
    await _store.clear();
    _setSession(null);
    _expired = false;
    notifyListeners();
  }

  /// Reads and clears [expired], so the reader is told once rather than on
  /// every rebuild.
  bool acknowledgeExpiry() {
    final expired = _expired;
    _expired = false;
    return expired;
  }

  Future<void> _expire() async {
    await _store.clear();
    _setSession(null);
    _expired = true;
    notifyListeners();
  }

  void _setSession(AuthSession? session) {
    _session = session;
    _revision++;
  }
}
