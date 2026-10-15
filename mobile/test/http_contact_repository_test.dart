import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/contact.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/contact/contact_failure.dart';
import 'package:publira/contact/http_contact_repository.dart';

import 'support/connect_fixture_server.dart';

void main() {
  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpContactRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpContactRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    accessToken = '';
    server = ConnectFixtureServer();
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('a guest sends the message without a session', () async {
    await repository().submit(
      replyToEmail: 'reader@example.com',
      subject: 'About my account',
      body: 'My date of birth is wrong.',
    );

    final call = server.requestsTo('SubmitContactMessage').single;
    expect(
      call.decode(pb.SubmitContactMessageRequest()),
      pb.SubmitContactMessageRequest(
        tenant: pb.TenantContext(
          tenantId: ConnectFixtureServer.defaultTenantId,
        ),
        replyToEmail: 'reader@example.com',
        subject: 'About my account',
        body: 'My date of birth is wrong.',
      ),
    );
    expect(call.headers['authorization'], isNull);
  });

  test('a signed-in reader sends their session along', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().submit(
      replyToEmail: 'reader@example.com',
      subject: '',
      body: 'Hello.',
    );

    final call = server.requestsTo('SubmitContactMessage').single;
    expect(call.headers['authorization'], 'Bearer $accessToken');
    expect(call.decode(pb.SubmitContactMessageRequest()).hasSubject(), isFalse);
  });

  for (final (code, status, kind) in [
    ('invalid_argument', HttpStatus.badRequest, ContactFailureKind.invalid),
    (
      'resource_exhausted',
      HttpStatus.tooManyRequests,
      ContactFailureKind.rateLimited,
    ),
    ('unavailable', HttpStatus.serviceUnavailable, ContactFailureKind.network),
    ('internal', HttpStatus.internalServerError, ContactFailureKind.unexpected),
  ]) {
    test('maps $code to ${kind.name}', () async {
      server
        ..contactStatus = status
        ..contactErrorCode = code;

      await expectLater(
        repository().submit(
          replyToEmail: 'reader@example.com',
          subject: '',
          body: 'Hello.',
        ),
        throwsA(
          isA<ContactFailure>().having((failure) => failure.kind, 'kind', kind),
        ),
      );
    });
  }
}
