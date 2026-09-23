import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/http_purchase_repository.dart';
import 'package:publira/purchase/purchase_failure.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const seriesId = ConnectFixtureServer.seedSeriesId;
  const freeEpisodeId = ConnectFixtureServer.seedEpisodeId;
  const paidEpisodeId = ConnectFixtureServer.paidEpisodeId;

  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpPurchaseRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpPurchaseRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  Matcher failsWith(PurchaseFailureKind kind) => throwsA(
    isA<PurchaseFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  setUp(() async {
    accessToken = '';
    server = ConnectFixtureServer(
      details: ConnectFixtureServer.populatedDetails(),
      episodes: ConnectFixtureServer.populatedEpisodes(),
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('a tenant takes payments only when it says so', () async {
    expect(await repository().acceptsPayments(), isFalse);

    server.acceptsPayments = true;
    expect(await repository().acceptsPayments(), isTrue);
  });

  test('the access of each episode is the reader\'s own', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.entitledEpisodes = ConnectFixtureServer.populatedEntitledEpisodes();

    expect(await repository().seriesEpisodeAccess(seriesId), {
      freeEpisodeId: EpisodeAccess.free,
      paidEpisodeId: EpisodeAccess.entitled,
    });
    final request = server.requestsTo('GetSeriesEpisodeAccess').single;
    expect(request.body['seriesPublicId'], seriesId);
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a checkout asks to come back to the app', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    expect(
      await repository().startEpisodeCheckout(paidEpisodeId),
      ConnectFixtureServer.checkoutUrlFor(paidEpisodeId),
    );
    final request = server.requestsTo('StartEpisodeCheckout').single;
    expect(request.body['client'], 'CLIENT_MOBILE');
    expect(request.body['episodePublicId'], paidEpisodeId);
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a guest is not sent to the API for a checkout', () async {
    await expectLater(
      repository().startEpisodeCheckout(paidEpisodeId),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    expect(server.requestsTo('StartEpisodeCheckout'), isEmpty);
  });

  test('an episode the reader already holds is not paid for again', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.entitledEpisodes = ConnectFixtureServer.populatedEntitledEpisodes();

    await expectLater(
      repository().startEpisodeCheckout(paidEpisodeId),
      failsWith(PurchaseFailureKind.alreadyPurchased),
    );
  });

  test('a session the API refuses asks for a sign-in', () async {
    accessToken = 'a-token-the-api-no-longer-accepts';

    await expectLater(
      repository().startEpisodeCheckout(paidEpisodeId),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
  });

  test('an API that cannot be reached is a network failure', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.checkoutStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().startEpisodeCheckout(paidEpisodeId),
      failsWith(PurchaseFailureKind.network),
    );
  });

  test('a checkout return finds the series of its episode', () async {
    expect(await repository().seriesOfEpisode(paidEpisodeId), seriesId);
    expect(await repository().seriesOfEpisode('SeedEPSDNONE'), isNull);
  });

  test('both catalog reads a purchase is offered from name the app', () async {
    await repository().seriesEpisodeAccess(seriesId);
    await repository().seriesOfEpisode(paidEpisodeId);

    expect(
      server.requestsTo('GetSeriesEpisodeAccess').single.body['surface'],
      'CLIENT_SURFACE_APP',
    );
    expect(
      server.requestsTo('GetEpisodeDetail').single.body['surface'],
      'CLIENT_SURFACE_APP',
    );
  });

  test('a series the storefront alone shows offers nothing to buy', () async {
    server.seriesAvailability = {seriesId: 'SURFACE_AVAILABILITY_WEB'};

    await expectLater(
      repository().seriesEpisodeAccess(seriesId),
      failsWith(PurchaseFailureKind.gone),
    );
    expect(await repository().seriesOfEpisode(paidEpisodeId), isNull);
  });
}
