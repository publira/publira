import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';

/// Sign-in and session checks against the public API.
abstract class AuthRepository {
  /// Signs [email] in with [password] and returns the session the API issued.
  ///
  /// Throws [AuthFailure].
  Future<AuthSession> signIn({required String email, required String password});

  /// Re-reads the reader behind [session], so a token restored from storage is
  /// confirmed before the app presents it as signed in.
  ///
  /// Throws [AuthFailure]; the kind is [AuthFailureKind.sessionExpired] once
  /// the API has rejected the token.
  Future<AuthSession> refresh(AuthSession session);
}
