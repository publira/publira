import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app remembers the registration token it has on the server.
///
/// The stored token is the switch: a token here means this device is
/// registered and the account screen shows notifications as on, and clearing
/// it is what turning them off means. Keeping the token rather than a boolean
/// also gives sign-out the value it has to unregister, which the messaging
/// service can no longer be asked for once it has been replaced.
abstract class PushDeviceStore {
  Future<String?> read();

  Future<void> write(String token);

  Future<void> clear();
}

/// [PushDeviceStore] backed by the OS keychain / Keystore, which is where the
/// app's other device-scoped secret — the session — already lives.
class SecurePushDeviceStore implements PushDeviceStore {
  const SecurePushDeviceStore({this.storage = const FlutterSecureStorage()});

  static const _key = 'publira.push.device_token';

  final FlutterSecureStorage storage;

  @override
  Future<String?> read() async {
    String? raw;
    try {
      raw = await storage.read(key: _key);
    } on PlatformException {
      // An entry the platform can no longer decrypt is unrecoverable. Reading
      // as "not registered" leaves the switch off, which the reader can turn
      // back on; the row the server still holds dies at the next send, because
      // this install's token was replaced along with the keystore.
      await clear();
      return null;
    }
    if (raw == null || raw.isEmpty) {
      return null;
    }
    return raw;
  }

  @override
  Future<void> write(String token) => storage.write(key: _key, value: token);

  @override
  Future<void> clear() => storage.delete(key: _key);
}
