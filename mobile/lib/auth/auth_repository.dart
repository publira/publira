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

  /// Whether the reader behind [session] has a birth date on file.
  ///
  /// Read when it is asked for rather than carried on the session: a reader
  /// who records their date and comes back is answered on what the account
  /// holds now, not on what it held when the app last started.
  ///
  /// Throws [AuthFailure].
  Future<bool> hasBirthDate(AuthSession session);
}
