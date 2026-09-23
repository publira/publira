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

  group('the purchase library', () {
    Map<String, Object?> purchase(
      String id, {
      required bool active,
      String expiresAt = '',
    }) => {
      'id': id,
      'episode': {
        'publicId': paidEpisodeId,
        'title': 'Seed Episode 001-10',
        'orderIndex': 10,
      },
      'series': {'publicId': seriesId, 'title': 'Seed Series 001'},
      'priceAtPurchase': 500,
      'purchasedAt': '2026-01-10T12:00:00Z',
      if (expiresAt.isNotEmpty) 'expiresAt': expiresAt,
      // protojson omits a false.
      if (active) 'isActive': true,
    };

    test('reads the reader\'s own purchases', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        purchase('purchase-active', active: true),
        purchase(
          'purchase-expired',
          active: false,
          expiresAt: '2026-01-13T12:00:00Z',
        ),
      ];

      final page = await repository().listMyPurchases();

      expect(page.nextToken, isEmpty);
      final [active, expired] = page.purchases;
      expect(active.id, 'purchase-active');
      expect(active.isActive, isTrue);
      expect(active.expiresAt, isNull);
      expect(active.seriesId, seriesId);
      expect(active.seriesTitle, 'Seed Series 001');
      expect(active.episodeId, paidEpisodeId);
      expect(active.episodeTitle, 'Seed Episode 001-10');
      expect(active.orderIndex, 10);
      expect(active.price, 500);
      expect(active.purchasedAt?.toUtc(), DateTime.utc(2026, 1, 10, 12));
      expect(expired.isActive, isFalse);
      expect(expired.expiresAt?.toUtc(), DateTime.utc(2026, 1, 13, 12));
      final request = server.requestsTo('ListMyPurchases').single;
      expect(request.headers['authorization'], 'Bearer $accessToken');
      expect(request.body['surface'], 'CLIENT_SURFACE_APP');
    });

    test('walks the pages the API names', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server
        ..myPurchases = [
          purchase('purchase-1', active: true),
          purchase('purchase-2', active: true),
          purchase('purchase-3', active: true),
        ]
        ..purchasesPageSize = 2;

      final first = await repository().listMyPurchases();
      final second = await repository().listMyPurchases(token: first.nextToken);

      expect(first.purchases.map((item) => item.id), [
        'purchase-1',
        'purchase-2',
      ]);
      expect(second.purchases.map((item) => item.id), ['purchase-3']);
      expect(second.nextToken, isEmpty);
    });

    test('a reader who bought nothing is answered an empty page', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      expect((await repository().listMyPurchases()).purchases, isEmpty);
    });

    test('a guest is not sent to the API for it', () async {
      expect((await repository().listMyPurchases()).purchases, isEmpty);
      expect(server.requestsTo('ListMyPurchases'), isEmpty);
    });

    test('a session the API refuses asks for a sign-in', () async {
      accessToken = 'a-token-the-api-no-longer-accepts';

      await expectLater(
        repository().listMyPurchases(),
        failsWith(PurchaseFailureKind.sessionExpired),
      );
    });
  });
}
