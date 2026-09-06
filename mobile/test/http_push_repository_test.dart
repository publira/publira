import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
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

    final request = server.requestsTo('RegisterPushDevice').single;
    expect(request.body['token'], 'device-token');
    expect(request.body['platform'], 'PUSH_PLATFORM_ANDROID');
    expect(
      (request.body['tenant']! as Map)['tenantId'],
      ConnectFixtureServer.defaultTenantId,
    );
  });

  test('an iOS device registers as the platform the server knows', () async {
    await push.register(token: 'device-token', platform: PushPlatform.ios);

    expect(
      server.requestsTo('RegisterPushDevice').single.body['platform'],
      'PUSH_PLATFORM_IOS',
    );
  });

  test('unregister names the token to take off the list', () async {
    await push.unregister('device-token');

    expect(
      server.requestsTo('UnregisterPushDevice').single.body['token'],
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
