import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/http_auth_repository.dart';
import 'package:publira/auth/login_device_store.dart';
import 'package:publira/auth/two_step_verification.dart';
import 'package:publira/config.dart';

import 'support/connect_fixture_server.dart';
import 'support/fake_auth.dart';

void main() {
  late ConnectFixtureServer server;
  late InMemoryLoginDeviceStore devices;
  late HttpAuthRepository auth;

  final stored = LoginDevice(
    token: 'stored-device-token',
    expiresAt: DateTime.utc(2100),
  );

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
    devices = InMemoryLoginDeviceStore();
    auth = HttpAuthRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
      loginDevices: devices,
    );
  });

  tearDown(() async {
    await server.close();
  });

  Future<void> signIn() => auth.signIn(
    email: ConnectFixtureServer.memberEmail,
    password: ConnectFixtureServer.memberPassword,
  );

  pb.LoginRequest sent() => server.requestsOf(pb.LoginRequest.new).single;

  group('a password sign-in', () {
    test('sends the stored device token', () async {
      devices.device = stored;

      await signIn();

      expect(sent().hasDeviceToken(), isTrue);
      expect(sent().deviceToken, 'stored-device-token');
    });

    test('sends no device token when none is stored', () async {
      await signIn();

      expect(sent().hasDeviceToken(), isFalse);
    });

    test('sends no device token once the stored one has expired', () async {
      devices.device = LoginDevice(
        token: 'expired-device-token',
        expiresAt: DateTime.utc(2000),
      );

      await signIn();

      expect(sent().hasDeviceToken(), isFalse);
    });

    test('goes ahead without a token the store cannot read', () async {
      devices.readError = PlatformException(code: 'unreadable');

      await signIn();

      expect(sent().hasDeviceToken(), isFalse);
    });
  });

  group('the device a password sign-in hands back', () {
    test('is stored with the session', () async {
      server.loginDevice = pb.LoginDevice(
        token: 'issued-device-token',
        expiresAt: '2100-01-01T00:00:00Z',
      );

      await signIn();

      expect(devices.device?.token, 'issued-device-token');
      expect(devices.device?.expiresAt, DateTime.utc(2100));
    });

    test('is stored with a two-step challenge', () async {
      server.memberMfaEnabled = true;
      server.loginDevice = pb.LoginDevice(
        token: 'issued-device-token',
        expiresAt: '2100-01-01T00:00:00Z',
      );

      await expectLater(signIn(), throwsA(isA<TwoStepVerificationRequired>()));

      expect(devices.device?.token, 'issued-device-token');
    });

    test('replaces the stored one', () async {
      devices.device = stored;
      server.loginDevice = pb.LoginDevice(
        token: 'issued-device-token',
        expiresAt: '2100-01-01T00:00:00Z',
      );

      await signIn();

      expect(devices.device?.token, 'issued-device-token');
    });

    test('leaves the stored one alone when the response has none', () async {
      devices.device = stored;

      await signIn();

      expect(devices.device, same(stored));
    });

    test('leaves the stored one alone when it has no usable expiry', () async {
      devices.device = stored;
      server.loginDevice = pb.LoginDevice(
        token: 'issued-device-token',
        expiresAt: 'tomorrow',
      );

      await signIn();

      expect(devices.device, same(stored));
    });

    test('does not fail the sign-in when the store refuses it', () async {
      devices.writeError = PlatformException(code: 'refused');
      server.loginDevice = pb.LoginDevice(
        token: 'issued-device-token',
        expiresAt: '2100-01-01T00:00:00Z',
      );

      final session = await auth.signIn(
        email: ConnectFixtureServer.memberEmail,
        password: ConnectFixtureServer.memberPassword,
      );

      expect(session.accessToken, ConnectFixtureServer.memberAccessToken);
    });
  });

  test('signing out leaves the stored device for the next sign-in', () async {
    server.loginDevice = pb.LoginDevice(
      token: 'issued-device-token',
      expiresAt: '2100-01-01T00:00:00Z',
    );
    final controller = AuthController(
      repository: auth,
      store: InMemorySessionStore(),
    );
    await controller.signIn(
      email: ConnectFixtureServer.memberEmail,
      password: ConnectFixtureServer.memberPassword,
    );

    await controller.signOut();

    expect(controller.session, isNull);
    expect(devices.device?.token, 'issued-device-token');
  });
}
