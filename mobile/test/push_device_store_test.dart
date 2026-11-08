import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/push/push_device_store.dart';
import 'package:publira/push/push_repository.dart';

void main() {
  const store = SecurePushDeviceStore();

  test('an installation ID reads back as one', () async {
    FlutterSecureStorage.setMockInitialValues({});

    await store.write(const PushToken.installationId('installation-id'));

    expect(
      await store.read(),
      const PushToken.installationId('installation-id'),
    );
  });

  test('a token an earlier release stored reads as a registration '
      'token', () async {
    FlutterSecureStorage.setMockInitialValues({
      'publira.push.device_token': 'registration-token',
    });

    expect(
      await store.read(),
      const PushToken(
        value: 'registration-token',
        type: PushTokenType.registrationToken,
      ),
    );
  });

  test('writing an installation ID replaces a stored registration '
      'token', () async {
    FlutterSecureStorage.setMockInitialValues({
      'publira.push.device_token': 'registration-token',
    });

    await store.write(const PushToken.installationId('installation-id'));

    expect(
      await store.read(),
      const PushToken.installationId('installation-id'),
    );
    expect(
      await const FlutterSecureStorage().read(key: 'publira.push.device_token'),
      isNull,
    );
  });

  test('clearing forgets a registration token an earlier release '
      'stored', () async {
    FlutterSecureStorage.setMockInitialValues({
      'publira.push.device_token': 'registration-token',
    });

    await store.clear();

    expect(await store.read(), isNull);
  });

  test('an entry this release cannot read is cleared as not '
      'registered', () async {
    FlutterSecureStorage.setMockInitialValues({
      'publira.push.device': '{"token":"installation-id","type":"unknown"}',
    });

    expect(await store.read(), isNull);
    expect(
      await const FlutterSecureStorage().read(key: 'publira.push.device'),
      isNull,
    );
  });
}
