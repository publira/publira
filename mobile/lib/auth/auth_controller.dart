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
  Future<void> restore() async {
    final stored = await _store.read();
    if (stored == null) {
      return;
    }
    if (stored.hasExpired(DateTime.now())) {
      await _expire();
      return;
    }
    _session = stored;
    notifyListeners();
    try {
      final refreshed = await _repository.refresh(stored);
      _session = refreshed;
      await _store.write(refreshed);
      notifyListeners();
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthFailureKind.sessionExpired) {
        await _expire();
      }
    }
  }

  /// Throws [AuthFailure] and leaves the current session alone when the API
  /// turns the credentials down.
  Future<void> signIn({required String email, required String password}) async {
    final session = await _repository.signIn(email: email, password: password);
    await _store.write(session);
    _session = session;
    _expired = false;
    notifyListeners();
  }

  Future<void> signOut() async {
    await _store.clear();
    _session = null;
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
    _session = null;
    _expired = true;
    notifyListeners();
  }
}
