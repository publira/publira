import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/session_store.dart';

/// [SessionStore] that keeps the session in memory.
///
/// `flutter test` has no platform keychain behind `SecureSessionStore`, and a
/// widget test wants to seed the stored session anyway.
class InMemorySessionStore implements SessionStore {
  InMemorySessionStore({this.session});

  AuthSession? session;

  @override
  Future<AuthSession?> read() async => session;

  @override
  Future<void> write(AuthSession session) async {
    this.session = session;
  }

  @override
  Future<void> clear() async {
    session = null;
  }
}

/// [AuthRepository] that answers from what a test sets on it.
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({
    this.session = fakeSession,
    this.signInFailure,
    this.refreshFailure,
  });

  /// What [signIn] returns, and what [refresh] echoes the user of.
  AuthSession session;
  AuthFailure? signInFailure;
  AuthFailure? refreshFailure;

  String? lastEmail;
  String? lastPassword;
  var refreshCount = 0;

  @override
  Future<AuthSession> signIn({
    required String email,
    required String password,
  }) async {
    lastEmail = email;
    lastPassword = password;
    final failure = signInFailure;
    if (failure != null) {
      throw failure;
    }
    return session;
  }

  @override
  Future<AuthSession> refresh(AuthSession session) async {
    refreshCount++;
    final failure = refreshFailure;
    if (failure != null) {
      throw failure;
    }
    return session.withUser(
      userPublicId: this.session.userPublicId,
      userName: this.session.userName,
    );
  }
}

const fakeSession = AuthSession(
  accessToken: 'fake-access-token',
  userPublicId: 'SeedMMBRAAA1',
  userName: 'Sample Member',
);

/// An [AuthController] over the fakes, signed out unless [session] is given.
AuthController fakeAuthController({
  AuthSession? session,
  AuthSession? storedSession,
  FakeAuthRepository? repository,
}) {
  return AuthController(
    repository: repository ?? FakeAuthRepository(),
    store: InMemorySessionStore(session: storedSession),
    session: session,
  );
}
