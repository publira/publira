import 'dart:async';

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
  InMemorySessionStore({this.session, this.writeError});

  AuthSession? session;

  /// Thrown by [write], standing in for a keychain that refuses one.
  Object? writeError;

  @override
  Future<AuthSession?> read() async => session;

  @override
  Future<void> write(AuthSession session) async {
    final error = writeError;
    if (error != null) {
      throw error;
    }
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

  /// Held open by a test that needs to act while [refresh] is still in flight.
  Completer<void>? refreshGate;

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
    await refreshGate?.future;
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
  InMemorySessionStore? store,
}) {
  return AuthController(
    repository: repository ?? FakeAuthRepository(),
    store: store ?? InMemorySessionStore(session: storedSession),
    session: session,
  );
}
