import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:publira/push/push_repository.dart';

/// Where the app remembers the value this device is registered on the server
/// under, and what kind of value it is.
///
/// The stored token is the switch: a token here means this device is
/// registered and the account screen shows notifications as on, and clearing
/// it is what turning them off means. Keeping the token rather than a boolean
/// also gives sign-out the value it has to unregister, which the messaging
/// service can no longer be asked for once it has been replaced, and keeping
/// its type lets a sign-in register it again as what it is when the device
/// cannot answer with the one it holds now.
abstract class PushDeviceStore {
  Future<PushToken?> read();

  Future<void> write(PushToken token);

  Future<void> clear();
}

/// [PushDeviceStore] backed by the OS keychain / Keystore, which is where the
/// app's other device-scoped secret — the session — already lives.
///
/// The token and its type are written together as one entry, so a write that
/// fails halfway cannot pair a value with the wrong type. Releases before the
/// move to installation IDs stored a bare registration token under a key of
/// its own, which is read as one while nothing has been written over it.
class SecurePushDeviceStore implements PushDeviceStore {
  const SecurePushDeviceStore({this.storage = const FlutterSecureStorage()});

  static const _key = 'publira.push.device';
  static const _registrationTokenKey = 'publira.push.device_token';

  final FlutterSecureStorage storage;

  @override
  Future<PushToken?> read() async {
    String? raw;
    String? registrationToken;
    try {
      raw = await storage.read(key: _key);
      if (raw == null) {
        registrationToken = await storage.read(key: _registrationTokenKey);
      }
    } on PlatformException {
      // An entry the platform can no longer decrypt is unrecoverable. Reading
      // as "not registered" leaves the switch off, which the reader can turn
      // back on; the row the server still holds dies at the next send, because
      // this install's token was replaced along with the keystore.
      await clear();
      return null;
    }
    if (raw != null) {
      final token = _decode(raw);
      if (token == null) {
        // Nothing this release wrote, so nothing it can register again.
        await clear();
      }
      return token;
    }
    if (registrationToken == null || registrationToken.isEmpty) {
      return null;
    }
    return PushToken(
      value: registrationToken,
      type: PushTokenType.registrationToken,
    );
  }

  @override
  Future<void> write(PushToken token) async {
    await storage.write(
      key: _key,
      value: jsonEncode({'token': token.value, 'type': token.type.name}),
    );
    try {
      await storage.delete(key: _registrationTokenKey);
    } on PlatformException {
      // The entry written above is read first, so the one left behind is
      // never read again.
    }
  }

  @override
  Future<void> clear() async {
    await storage.delete(key: _key);
    await storage.delete(key: _registrationTokenKey);
  }

  static PushToken? _decode(String raw) {
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded case {
      'token': final String value,
      'type': final String name,
    } when value.isNotEmpty) {
      final type = PushTokenType.values.asNameMap()[name];
      return type == null ? null : PushToken(value: value, type: type);
    }
    return null;
  }
}
