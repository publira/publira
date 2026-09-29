import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The random key one install encrypts its saved episodes with.
abstract class DeviceKeyStore {
  /// The key, minted on first use and the same on every launch after it.
  ///
  /// Throws when the platform has no credential store to hold it, which is
  /// what turns offline reading off rather than saving pages under a key that
  /// would not survive the launch.
  Future<Uint8List> read();
}

/// [DeviceKeyStore] backed by the OS keychain / Keystore.
///
/// The key reads every saved page on the device, so it belongs beside the
/// session token in the platform credential store rather than in a file next
/// to the pages it protects.
class SecureDeviceKeyStore implements DeviceKeyStore {
  const SecureDeviceKeyStore({this.storage = const FlutterSecureStorage()});

  static const _key = 'publira.offline.key';

  /// 256 bits, the block size of the HMAC-SHA256 keystream it feeds.
  static const keyLength = 32;

  final FlutterSecureStorage storage;

  @override
  Future<Uint8List> read() async {
    final stored = await _readStored();
    if (stored != null) {
      return stored;
    }
    // A key of the wrong length, or one the platform can no longer decrypt,
    // is replaced rather than repaired. The library reads its index with the
    // key it gets and wipes what it cannot decode, so a new key costs the
    // saved episodes and nothing else.
    final minted = _mint();
    await storage.write(key: _key, value: base64Encode(minted));
    return minted;
  }

  Future<Uint8List?> _readStored() async {
    String? raw;
    try {
      raw = await storage.read(key: _key);
    } on PlatformException {
      return null;
    }
    if (raw == null || raw.isEmpty) {
      return null;
    }
    try {
      final decoded = base64Decode(raw);
      return decoded.length == keyLength ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  static Uint8List _mint() {
    final random = Random.secure();
    return Uint8List.fromList(
      List<int>.generate(keyLength, (_) => random.nextInt(256)),
    );
  }
}
