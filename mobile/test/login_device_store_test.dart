import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/auth/login_device_store.dart';
import 'package:publira/auth/session_store.dart';

void main() {
  const store = SecureLoginDeviceStore();

  test('a device reads back with its token and expiry', () async {
    FlutterSecureStorage.setMockInitialValues({});

    await store.write(
      LoginDevice(token: 'device-token', expiresAt: DateTime.utc(2100)),
    );

    final device = await store.read();
    expect(device?.token, 'device-token');
    expect(device?.expiresAt, DateTime.utc(2100));
  });

  test('nothing stored reads as none', () async {
    FlutterSecureStorage.setMockInitialValues({});

    expect(await store.read(), isNull);
  });

  test('an entry this release cannot read reads as none', () async {
    FlutterSecureStorage.setMockInitialValues({
      'publira.auth.login_device': '{"token":"device-token"}',
    });

    expect(await store.read(), isNull);
  });

  test('clearing the session leaves the device', () async {
    FlutterSecureStorage.setMockInitialValues({});
    const sessions = SecureSessionStore();
    await sessions.write(
      const AuthSession(
        accessToken: 'access-token',
        userPublicId: 'reader',
        userName: 'Reader',
      ),
    );
    await store.write(
      LoginDevice(token: 'device-token', expiresAt: DateTime.utc(2100)),
    );

    await sessions.clear();

    expect(await sessions.read(), isNull);
    expect((await store.read())?.token, 'device-token');
  });
}
