import 'dart:async';

import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_repository.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/reader_age.dart';
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
    this.birthDate = '',
    this.verification = AgeVerification.checked,
    this.birthDateFailure,
    this.recordFailure,
    this.email = 'member@example.com',
    this.emailFailure,
  });

  /// What [signIn] returns, and what [refresh] echoes the user of.
  AuthSession session;
  AuthFailure? signInFailure;
  AuthFailure? refreshFailure;

  /// The `YYYY-MM-DD` the account holds, empty while it holds none.
  /// [recordBirthDate] writes it.
  String birthDate;

  AgeVerification verification;

  /// Thrown by [readReaderAge], standing in for an account that cannot be
  /// read.
  AuthFailure? birthDateFailure;

  /// Thrown by [recordBirthDate], standing in for an API that refuses it.
  AuthFailure? recordFailure;

  /// What [readEmail] answers, and [emailFailure] what it throws instead.
  String email;
  AuthFailure? emailFailure;

  /// Held open by a test that needs to act while [readEmail] is in flight.
  Completer<void>? emailGate;

  /// The zone [readReaderAge] reports. Seoul has no daylight saving, so a
  /// test's arithmetic about its calendar day does not drift with the season.
  static const timeZone = 'Asia/Seoul';

  /// Held open by a test that needs to act while [refresh] is still in flight.
  Completer<void>? refreshGate;

  String? lastEmail;
  String? lastPassword;
  var refreshCount = 0;

  /// What [signUp] was last called with, `null` until it has been called.
  SignUpCall? lastSignUp;

  /// Thrown by [signUp], standing in for an API that refuses it.
  AuthFailure? signUpFailure;

  /// The tokens [verifyEmail] accepts. Anything else is answered the way the
  /// API answers a token it never issued.
  Set<String> verificationTokens = {};

  /// Thrown by [verifyEmail] in place of reading [verificationTokens],
  /// standing in for a link whose time has run out or an API that is gone.
  AuthFailure? verifyEmailFailure;

  /// The addresses [requestEmailVerification] has been asked for, in order.
  final requestedVerifications = <String>[];

  /// Thrown by [requestEmailVerification].
  AuthFailure? requestVerificationFailure;

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
  Future<void> signUp({
    required String name,
    required String email,
    required String password,
    String birthDate = '',
  }) async {
    lastSignUp = SignUpCall(
      name: name,
      email: email,
      password: password,
      birthDate: birthDate,
    );
    final failure = signUpFailure;
    if (failure != null) {
      throw failure;
    }
  }

  @override
  Future<void> verifyEmail(String token) async {
    final failure = verifyEmailFailure;
    if (failure != null) {
      throw failure;
    }
    if (!verificationTokens.contains(token)) {
      throw const AuthFailure(AuthFailureKind.verificationTokenInvalid);
    }
  }

  @override
  Future<void> requestEmailVerification(String email) async {
    requestedVerifications.add(email);
    final failure = requestVerificationFailure;
    if (failure != null) {
      throw failure;
    }
  }

  @override
  Future<AgeVerification> readAgeVerification() async {
    final failure = birthDateFailure;
    if (failure != null) {
      throw failure;
    }
    return verification;
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

  @override
  Future<ReaderAge> readReaderAge(AuthSession session) async {
    final failure = birthDateFailure;
    if (failure != null) {
      throw failure;
    }
    return ReaderAge(
      birthDate: birthDate,
      timeZone: timeZone,
      verification: verification,
    );
  }

  @override
  Future<String> readEmail(AuthSession session) async {
    await emailGate?.future;
    final failure = emailFailure;
    if (failure != null) {
      throw failure;
    }
    return email;
  }

  @override
  Future<String> recordBirthDate(
    AuthSession session,
    DateTime birthDate,
  ) async {
    final failure = recordFailure;
    if (failure != null) {
      throw failure;
    }
    if (this.birthDate.isNotEmpty) {
      throw const AuthFailure(AuthFailureKind.birthDateAlreadySet);
    }
    this.birthDate = formatBirthDate(birthDate);
    return this.birthDate;
  }
}

/// One call to [FakeAuthRepository.signUp], so a test can assert on what the
/// form sent rather than only on what the screen did next.
class SignUpCall {
  const SignUpCall({
    required this.name,
    required this.email,
    required this.password,
    required this.birthDate,
  });

  final String name;
  final String email;
  final String password;

  /// `YYYY-MM-DD`, empty from a form that did not ask.
  final String birthDate;
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
  String birthDate = '',
  AuthFailure? birthDateFailure,
}) {
  return AuthController(
    repository:
        repository ??
        FakeAuthRepository(
          birthDate: birthDate,
          birthDateFailure: birthDateFailure,
        ),
    store: store ?? InMemorySessionStore(session: storedSession),
    session: session,
  );
}
