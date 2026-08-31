import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:publira/auth/auth_session.dart';

/// Where the app keeps the signed-in reader's session between launches.
abstract class SessionStore {
  /// The stored session, or `null` when there is none to restore.
  Future<AuthSession?> read();

  Future<void> write(AuthSession session);

  Future<void> clear();
}

/// [SessionStore] backed by the OS keychain / Keystore.
///
/// A session carries a bearer token, so it goes to the platform's own
/// credential store rather than to `shared_preferences`, which keeps what it
/// holds in plain text.
class SecureSessionStore implements SessionStore {
  const SecureSessionStore({this.storage = const FlutterSecureStorage()});

  static const _key = 'publira.auth.session';

  final FlutterSecureStorage storage;

  @override
  Future<AuthSession?> read() async {
    String? raw;
    try {
      raw = await storage.read(key: _key);
    } on PlatformException {
      // A keystore entry the platform can no longer decrypt — after a device
      // restore, say — is unrecoverable, so drop it and read as signed out.
      await clear();
      return null;
    }
    if (raw == null || raw.isEmpty) {
      return null;
    }
    AuthSession? session;
    try {
      session = AuthSession.fromJson(jsonDecode(raw));
    } on FormatException {
      session = null;
    }
    if (session == null) {
      await clear();
    }
    return session;
  }

  @override
  Future<void> write(AuthSession session) =>
      storage.write(key: _key, value: jsonEncode(session.toJson()));

  @override
  Future<void> clear() => storage.delete(key: _key);
}
