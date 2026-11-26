import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The token a password sign-in hands back once the password was right, and
/// when the server stops honouring it.
///
/// A later password sign-in that sends it back counts against an allowance of
/// this device's own rather than the one every stranger trying the address
/// shares, so failures from elsewhere cannot lock the reader out here.
class LoginDevice {
  const LoginDevice({required this.token, required this.expiresAt});

  final String token;
  final DateTime expiresAt;

  bool isLiveAt(DateTime now) => now.isBefore(expiresAt);
}

/// Where the app keeps the [LoginDevice].
///
/// It is kept apart from the session and outlives it: the token vouches for
/// the device, not for a signed-in reader, so signing out or a session that
/// expires leaves it for the next sign-in to send.
abstract class LoginDeviceStore {
  /// The stored device, `null` before a sign-in has handed one over.
  Future<LoginDevice?> read();

  Future<void> write(LoginDevice device);
}

/// [LoginDeviceStore] backed by the OS keychain / Keystore, beside the
/// session under a key of its own.
///
/// The token is a credential the server reads, so it goes where the session
/// goes rather than to a file.
class SecureLoginDeviceStore implements LoginDeviceStore {
  const SecureLoginDeviceStore({this.storage = const FlutterSecureStorage()});

  static const _key = 'publira.auth.login_device';

  final FlutterSecureStorage storage;

  @override
  Future<LoginDevice?> read() async {
    String? raw;
    try {
      raw = await storage.read(key: _key);
    } on PlatformException {
      // An entry the platform can no longer decrypt reads as none; the next
      // sign-in whose password is right writes a new one over it.
      return null;
    }
    if (raw == null || raw.isEmpty) {
      return null;
    }
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded case {
      'token': final String token,
      'expiresAt': final String expiresAt,
    } when token.isNotEmpty) {
      final at = DateTime.tryParse(expiresAt);
      return at == null ? null : LoginDevice(token: token, expiresAt: at);
    }
    return null;
  }

  @override
  Future<void> write(LoginDevice device) => storage.write(
    key: _key,
    value: jsonEncode({
      'token': device.token,
      'expiresAt': device.expiresAt.toUtc().toIso8601String(),
    }),
  );
}
