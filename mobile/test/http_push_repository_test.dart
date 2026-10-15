import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/v1/notification.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/push/http_push_repository.dart';
import 'package:publira/push/push_repository.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late HttpPushRepository push;

  setUp(() async {
    server = ConnectFixtureServer();
    await server.start();
    final client = ConnectClient(baseUrl: server.baseUrl);
    push = HttpPushRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  });

  tearDown(() async {
    await server.close();
  });

  test('register names the tenant, the token, and the platform', () async {
    await push.register(token: 'device-token', platform: PushPlatform.android);

    final request = server.requestsOf(pb.RegisterPushDeviceRequest.new).single;
    expect(request.token, 'device-token');
    expect(request.platform, pb.PushPlatform.PUSH_PLATFORM_ANDROID);
    expect(request.tenant.tenantId, ConnectFixtureServer.defaultTenantId);
  });

  test('an iOS device registers as the platform the server knows', () async {
    await push.register(token: 'device-token', platform: PushPlatform.ios);

    expect(
      server.requestsOf(pb.RegisterPushDeviceRequest.new).single.platform,
      pb.PushPlatform.PUSH_PLATFORM_IOS,
    );
  });

  test('unregister names the token to take off the list', () async {
    await push.unregister('device-token');

    expect(
      server.requestsOf(pb.UnregisterPushDeviceRequest.new).single.token,
      'device-token',
    );
  });

  test('an API that turns the registration down reports it', () async {
    server.pushDeviceStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      push.register(token: 'device-token', platform: PushPlatform.android),
      throwsA(isA<ConnectException>()),
    );
  });
}
