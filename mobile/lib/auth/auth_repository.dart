import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/reader_age.dart';

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

  /// Writes [birthDate] to the account behind [session] and returns the date
  /// the account then holds, as `YYYY-MM-DD`.
  ///
  /// Throws [AuthFailure].
  Future<String> recordBirthDate(AuthSession session, DateTime birthDate);
}
