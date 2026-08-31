import 'package:flutter/foundation.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/session_store.dart';

/// Holds the signed-in reader for the whole app and keeps [SessionStore] in
/// step with it.
///
/// Everything that authorizes a request reads [accessToken] from here, so a
/// sign-in or a sign-out reaches the next API and image request without any
/// other wiring.
class AuthController extends ChangeNotifier {
  AuthController({
    required AuthRepository repository,
    required SessionStore store,
    AuthSession? session,
  }) : _repository = repository,
       _store = store,
       _session = session;

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
