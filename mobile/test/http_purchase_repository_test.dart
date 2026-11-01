import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/subscription.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/http_purchase_repository.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const seriesId = ConnectFixtureServer.seedSeriesId;
  const freeEpisodeId = ConnectFixtureServer.seedEpisodeId;
  const paidEpisodeId = ConnectFixtureServer.paidEpisodeId;

  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest —
  /// on a device that buys through [store].
  HttpPurchaseRepository repository({InAppPurchaseStore? store}) {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpPurchaseRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
      store: store,
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

  test('the tenant names the currency it sells in', () async {
    expect(await repository().currency(), 'JPY');

    server.currency = 'USD';
    expect(await repository().currency(), 'USD');
  });

  test('an answer that names no currency is a failure', () async {
    server.currency = '';
    await expectLater(
      repository().currency(),
      throwsA(
        isA<PurchaseFailure>().having(
          (failure) => failure.kind,
          'kind',
          PurchaseFailureKind.unexpected,
        ),
      ),
    );
  });

  test('a tenant takes payments only when it says so', () async {
    expect(await repository().acceptsPayments(), isFalse);

    server.acceptsPayments = true;
    expect(await repository().acceptsPayments(), isTrue);
  });

  test('a tenant that has chosen nothing sells through the checkout', () async {
    expect(
      await repository().appPurchaseRoute(),
      AppPurchaseRoute.externalCheckout,
    );

    server.appPurchaseRoute = pb.AppPurchaseRoute.APP_PURCHASE_ROUTE_STORE;
    expect(await repository().appPurchaseRoute(), AppPurchaseRoute.store);
  });

  test('on the store route payments follow the store of the device', () async {
    server
      ..appPurchaseRoute = pb.AppPurchaseRoute.APP_PURCHASE_ROUTE_STORE
      // The web checkout is ready, which the store route does not use.
      ..acceptsPayments = true
      ..acceptsAppStorePayments = true;

    expect(
      await repository(store: InAppPurchaseStore.appStore).acceptsPayments(),
      isTrue,
    );
    expect(
      await repository(store: InAppPurchaseStore.googlePlay).acceptsPayments(),
      isFalse,
    );
    expect(await repository().acceptsPayments(), isFalse);
  });

  test('a store purchase opens an intent for the device\'s store', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    final intent = await repository().startStorePurchase(
      ConnectFixtureServer.internalIdOf(paidEpisodeId),
      InAppPurchaseStore.googlePlay,
    );
    expect(intent.intentId, ConnectFixtureServer.storeIntentId);
    expect(intent.productId, ConnectFixtureServer.storeProductId);
    final call = server.requestsTo('StartStorePurchase').single;
    final request = call.decode(pb.StartStorePurchaseRequest());
    expect(request.episodeId, ConnectFixtureServer.internalIdOf(paidEpisodeId));
    expect(
      request.store,
      pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
    );
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test('a store purchase of a pack names the pack and no episode', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    final intent = await repository().startCoinPackStorePurchase(
      '0190a0a0-0000-7000-8000-000000000001',
      InAppPurchaseStore.appStore,
    );
    expect(intent.intentId, ConnectFixtureServer.storeIntentId);
    final request = server
        .requestsTo('StartStorePurchase')
        .single
        .decode(pb.StartStorePurchaseRequest());
    expect(request.coinPackId, '0190a0a0-0000-7000-8000-000000000001');
    expect(request.hasEpisodeId(), isFalse);
    expect(
      request.store,
      pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_APP_STORE,
    );
  });

  test('a store that is not ready does not sell the episode', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.storeStartStatus = HttpStatus.badRequest;

    await expectLater(
      repository().startStorePurchase(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        InAppPurchaseStore.appStore,
      ),
      failsWith(PurchaseFailureKind.notSold),
    );
  });

  test('a transaction is handed to the server with its product', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().confirmStorePurchase(
      store: InAppPurchaseStore.appStore,
      transaction: 'signed-transaction',
      productId: 'episode_500',
    );
    final call = server.requestsTo('ConfirmStorePurchase').single;
    final request = call.decode(pb.ConfirmStorePurchaseRequest());
    expect(
      request.store,
      pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_APP_STORE,
    );
    expect(request.transaction, 'signed-transaction');
    expect(request.productId, 'episode_500');
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test('a transaction the store has not settled is confirmed later', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.storeConfirmStatus = HttpStatus.badRequest;

    await expectLater(
      repository().confirmStorePurchase(
        store: InAppPurchaseStore.appStore,
        transaction: 'signed-transaction',
        productId: 'episode_500',
      ),
      failsWith(PurchaseFailureKind.notSettled),
    );
  });

  test('a guest is not sent to the API for a store purchase', () async {
    await expectLater(
      repository().startStorePurchase(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        InAppPurchaseStore.appStore,
      ),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    await expectLater(
      repository().confirmStorePurchase(
        store: InAppPurchaseStore.appStore,
        transaction: 'signed-transaction',
        productId: 'episode_500',
      ),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    expect(server.requestsTo('StartStorePurchase'), isEmpty);
    expect(server.requestsTo('ConfirmStorePurchase'), isEmpty);
  });

  test('the access of each episode is the reader\'s own', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.entitledEpisodes = ConnectFixtureServer.populatedEntitledEpisodes();

    expect(
      (await repository().seriesEpisodeAccess(
        ConnectFixtureServer.internalIdOf(seriesId),
      )).access,
      {
        freeEpisodeId: EpisodeAccess.free,
        paidEpisodeId: EpisodeAccess.entitled,
      },
    );
    final call = server.requestsTo('GetSeriesEpisodeAccess').single;
    expect(
      call.decode(pb.GetSeriesEpisodeAccessRequest()).seriesId,
      ConnectFixtureServer.internalIdOf(seriesId),
    );
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test('says which grant opens each episode the reader may read', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.entitledEpisodes = {
      paidEpisodeId:
          ConnectFixtureServer.populatedEntitledEpisodes()[paidEpisodeId]!
            ..entitlementSource = pb
                .EpisodeEntitlementSource
                .EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION,
    };

    final holdings = await repository().seriesEpisodeAccess(
      ConnectFixtureServer.internalIdOf(seriesId),
    );

    expect(holdings.access[paidEpisodeId], EpisodeAccess.entitled);
    // A free episode is open to everyone, so no grant is named for it.
    expect(holdings.entitlementSources, {
      paidEpisodeId: EpisodeEntitlementSource.subscription,
    });
  });

  test('the plans name what each one opens', () async {
    server.subscriptionPlans = [
      pb.SubscriptionPlan(
        id: 'plan-all',
        scope: pb.SubscriptionPlanScope.SUBSCRIPTION_PLAN_SCOPE_ALL,
      ),
      pb.SubscriptionPlan(
        id: 'plan-label',
        scope: pb.SubscriptionPlanScope.SUBSCRIPTION_PLAN_SCOPE_LABEL,
        labels: [pb.PublishedLabel(publicId: 'SeedLABLAAA1')],
      ),
      pb.SubscriptionPlan(
        id: 'plan-series',
        scope: pb.SubscriptionPlanScope.SUBSCRIPTION_PLAN_SCOPE_SERIES,
        series: [pb.Series(publicId: seriesId)],
      ),
      // A scope this build has no name for opens nothing it could say.
      pb.SubscriptionPlan(id: 'plan-unknown'),
    ];

    final plans = await repository().subscriptionPlans();

    expect(
      [for (final plan in plans) plan.scope],
      [
        SubscriptionPlanScope.all,
        SubscriptionPlanScope.label,
        SubscriptionPlanScope.series,
      ],
    );
    expect(plans[1].labelIds, {'SeedLABLAAA1'});
    expect(plans[2].seriesIds, {seriesId});
    final call = server.requestsTo('ListSubscriptionPlans').single;
    expect(
      call.decode(pb.ListSubscriptionPlansRequest()).surface,
      appClientSurface,
    );
  });

  test('a plan opens the works its scope names', () {
    const all = SubscriptionPlan(scope: SubscriptionPlanScope.all);
    const label = SubscriptionPlan(
      scope: SubscriptionPlanScope.label,
      labelIds: {'LABEL1'},
    );
    const series = SubscriptionPlan(
      scope: SubscriptionPlanScope.series,
      seriesIds: {'SERIES1'},
    );

    expect(all.opens(seriesId: 'SERIES2'), isTrue);
    expect(label.opens(seriesId: 'SERIES2', labelId: 'LABEL1'), isTrue);
    expect(label.opens(seriesId: 'SERIES2', labelId: 'LABEL2'), isFalse);
    // A series under no label is opened by no plan of labels.
    expect(label.opens(seriesId: 'SERIES2'), isFalse);
    expect(series.opens(seriesId: 'SERIES1'), isTrue);
    expect(series.opens(seriesId: 'SERIES2', labelId: 'LABEL1'), isFalse);
  });

  test('says which episodes the reader owns and what the rest costs', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.ownedEpisodes = {paidEpisodeId};
    server.seriesRemainders = {
      seriesId: pb.SeriesRemainderOffer(
        episodeCount: 3,
        listPrice: 900,
        discountPercent: 10,
        price: 810,
      ),
    };

    final holdings = await repository().seriesEpisodeAccess(
      ConnectFixtureServer.internalIdOf(seriesId),
    );

    expect(holdings.ownedEpisodeIds, {
      ConnectFixtureServer.internalIdOf(paidEpisodeId),
    });
    final remainder = holdings.remainder!;
    expect(remainder.episodeCount, 3);
    expect(remainder.listPrice, 900);
    expect(remainder.discountPercent, 10);
    expect(remainder.price, 810);
  });

  test('a series with nothing left to sell quotes nothing', () async {
    final holdings = await repository().seriesEpisodeAccess(
      ConnectFixtureServer.internalIdOf(seriesId),
    );

    expect(holdings.ownedEpisodeIds, isEmpty);
    expect(holdings.remainder, isNull);
  });

  test('a volume checkout asks to come back to the app', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    expect(
      await repository().startVolumeCheckout('volume-1'),
      ConnectFixtureServer.checkoutUrlFor('volume-1'),
    );
    final call = server.requestsTo('StartVolumeCheckout').single;
    final request = call.decode(pb.StartVolumeCheckoutRequest());
    expect(request.client, pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE);
    expect(request.volumeId, 'volume-1');
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test(
    'a checkout of the rest of a series names it in the reader\'s locale',
    () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      final internalId = ConnectFixtureServer.internalIdOf(seriesId);

      expect(
        await repository().startSeriesRemainderCheckout(
          internalId,
          locale: 'ko',
        ),
        ConnectFixtureServer.checkoutUrlFor(internalId),
      );
      final call = server.requestsTo('StartSeriesRemainderCheckout').single;
      final request = call.decode(pb.StartSeriesRemainderCheckoutRequest());
      expect(
        request.client,
        pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE,
      );
      expect(request.seriesId, internalId);
      expect(request.locale, 'ko');
      expect(call.headers['authorization'], 'Bearer $accessToken');
    },
  );

  test('a guest is not sent to the API for a volume or the rest', () async {
    await expectLater(
      repository().startVolumeCheckout('volume-1'),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    await expectLater(
      repository().startSeriesRemainderCheckout(
        ConnectFixtureServer.internalIdOf(seriesId),
        locale: 'en',
      ),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    expect(server.requestsTo('StartVolumeCheckout'), isEmpty);
    expect(server.requestsTo('StartSeriesRemainderCheckout'), isEmpty);
  });

  test('a refused volume or rest says why', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    final internalId = ConnectFixtureServer.internalIdOf(seriesId);

    for (final (code, kind) in [
      ('already_exists', PurchaseFailureKind.alreadyPurchased),
      ('not_found', PurchaseFailureKind.gone),
      ('failed_precondition', PurchaseFailureKind.notSold),
    ]) {
      server.bundleCheckoutRefusal = code;
      await expectLater(
        repository().startVolumeCheckout('volume-1'),
        failsWith(kind),
      );
      await expectLater(
        repository().startSeriesRemainderCheckout(internalId, locale: 'en'),
        failsWith(kind),
      );
    }
  });

  test('a checkout asks to come back to the app', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    expect(
      await repository().startEpisodeCheckout(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        locale: 'en',
      ),
      ConnectFixtureServer.checkoutUrlFor(paidEpisodeId),
    );
    final call = server.requestsTo('StartEpisodeCheckout').single;
    final request = call.decode(pb.StartEpisodeCheckoutRequest());
    expect(request.client, pb.StartEpisodeCheckoutRequest_Client.CLIENT_MOBILE);
    expect(request.episodeId, ConnectFixtureServer.internalIdOf(paidEpisodeId));
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test('a checkout names the episode in the reader\'s locale', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().startEpisodeCheckout(
      ConnectFixtureServer.internalIdOf(paidEpisodeId),
      locale: 'ko',
    );

    expect(
      server.requestsOf(pb.StartEpisodeCheckoutRequest.new).single.locale,
      'ko',
    );
  });

  test('a checkout names the sale it is for', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    final episodeId = ConnectFixtureServer.internalIdOf(paidEpisodeId);

    await repository().startEpisodeCheckout(episodeId, locale: 'en');
    await repository().startEpisodeCheckout(
      episodeId,
      locale: 'en',
      kind: PurchaseKind.rental,
    );

    expect(
      server
          .requestsOf(pb.StartEpisodeCheckoutRequest.new)
          .map((request) => request.kind),
      [
        pb.PurchaseKind.PURCHASE_KIND_PURCHASE,
        pb.PurchaseKind.PURCHASE_KIND_RENTAL,
      ],
    );
  });

  test('a guest is not sent to the API for a checkout', () async {
    await expectLater(
      repository().startEpisodeCheckout(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        locale: 'en',
      ),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
    expect(server.requestsTo('StartEpisodeCheckout'), isEmpty);
  });

  test('an episode the reader already holds is not paid for again', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.entitledEpisodes = ConnectFixtureServer.populatedEntitledEpisodes();

    await expectLater(
      repository().startEpisodeCheckout(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        locale: 'en',
      ),
      failsWith(PurchaseFailureKind.alreadyPurchased),
    );
  });

  test('a session the API refuses asks for a sign-in', () async {
    accessToken = 'a-token-the-api-no-longer-accepts';

    await expectLater(
      repository().startEpisodeCheckout(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        locale: 'en',
      ),
      failsWith(PurchaseFailureKind.sessionExpired),
    );
  });

  test('an API that cannot be reached is a network failure', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.checkoutStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().startEpisodeCheckout(
        ConnectFixtureServer.internalIdOf(paidEpisodeId),
        locale: 'en',
      ),
      failsWith(PurchaseFailureKind.network),
    );
  });

  test('a checkout return finds the series of its episode', () async {
    expect(await repository().seriesOfEpisode(paidEpisodeId), seriesId);
    expect(await repository().seriesOfEpisode('SeedEPSDNONE'), isNull);
  });

  test('both catalog reads a purchase is offered from name the app', () async {
    await repository().seriesEpisodeAccess(
      ConnectFixtureServer.internalIdOf(seriesId),
    );
    await repository().seriesOfEpisode(paidEpisodeId);

    expect(
      server.requestsOf(pb.GetSeriesEpisodeAccessRequest.new).single.surface,
      appClientSurface,
    );
    expect(
      server.requestsOf(pb.GetEpisodeDetailRequest.new).single.surface,
      appClientSurface,
    );
  });

  test('a series the storefront alone shows offers nothing to buy', () async {
    server.seriesAvailability = {
      seriesId: pb.SurfaceAvailability.SURFACE_AVAILABILITY_WEB,
    };

    await expectLater(
      repository().seriesEpisodeAccess(seriesId),
      failsWith(PurchaseFailureKind.gone),
    );
    expect(await repository().seriesOfEpisode(paidEpisodeId), isNull);
  });

  group('the reader\'s plan', () {
    test('reads the plan, where it stands, and who bills it', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.mySubscription = pb.Subscription(
        plan: pb.SubscriptionPlan(name: ' Unlimited '),
        status: pb.SubscriptionStatus.SUBSCRIPTION_STATUS_PAST_DUE,
        currentPeriodEnd: '2026-12-01T12:00:00Z',
        cancelAtPeriodEnd: true,
        store: pb.InAppPurchaseStore.IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
      );

      final subscription = (await repository().mySubscription())!;

      expect(subscription.planName, 'Unlimited');
      expect(subscription.status, SubscriptionStatus.pastDue);
      expect(
        subscription.currentPeriodEnd,
        DateTime.utc(2026, 12, 1, 12).toLocal(),
      );
      expect(subscription.cancelAtPeriodEnd, isTrue);
      expect(subscription.store, InAppPurchaseStore.googlePlay);
    });

    test('a plan the web checkout bills names no store', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.mySubscription = pb.Subscription(
        plan: pb.SubscriptionPlan(name: 'Unlimited'),
        status: pb.SubscriptionStatus.SUBSCRIPTION_STATUS_ACTIVE,
      );

      final subscription = (await repository().mySubscription())!;

      expect(subscription.status, SubscriptionStatus.active);
      expect(subscription.currentPeriodEnd, isNull);
      expect(subscription.store, isNull);
    });

    test('a status this build has no name for reads as over', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.mySubscription = pb.Subscription(
        plan: pb.SubscriptionPlan(name: 'Unlimited'),
      );

      final subscription = (await repository().mySubscription())!;

      expect(subscription.status, SubscriptionStatus.unknown);
      expect(subscription.status.held, isFalse);
    });

    test('a reader who has never subscribed holds no plan', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      expect(await repository().mySubscription(), isNull);
    });

    test('a guest is not sent to the API for a plan', () async {
      expect(await repository().mySubscription(), isNull);
      expect(server.requestsTo('GetMySubscription'), isEmpty);
    });

    test('a session the API refuses asks for a sign-in', () async {
      accessToken = 'expired';

      await expectLater(
        repository().mySubscription(),
        failsWith(PurchaseFailureKind.sessionExpired),
      );
    });

    test('billing opens the page the API answers', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      expect(
        await repository().startBillingPortal(),
        Uri.parse(server.billingPortalUrl),
      );
    });

    test('billing with nothing to manage says so', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.billingPortalRefusal = 'failed_precondition';

      await expectLater(
        repository().startBillingPortal(),
        failsWith(PurchaseFailureKind.notSold),
      );
    });

    test('billing is not handed to the browser unless it is https', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.billingPortalUrl = 'http://billing.stripe.test/p/session/member';

      await expectLater(
        repository().startBillingPortal(),
        failsWith(PurchaseFailureKind.unexpected),
      );
    });

    test('a guest is not sent to the API for billing', () async {
      await expectLater(
        repository().startBillingPortal(),
        failsWith(PurchaseFailureKind.sessionExpired),
      );
      expect(server.requestsTo('CreateBillingPortalSession'), isEmpty);
    });
  });

  group('the purchase library', () {
    pb.MyPurchase purchase(
      String id, {
      required bool active,
      String expiresAt = '',
    }) => pb.MyPurchase(
      id: id,
      episode: pb.Episode(
        publicId: paidEpisodeId,
        title: 'Seed Episode 001-10',
        orderIndex: 10,
      ),
      series: pb.Series(publicId: seriesId, title: 'Seed Series 001'),
      priceAtPurchase: 500,
      currency: 'USD',
      purchasedAt: '2026-01-10T12:00:00Z',
      expiresAt: expiresAt.isNotEmpty ? expiresAt : null,
      // The wire format omits a false.
      isActive: active ? true : null,
    );

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

      final page = await repository().listMyPurchases(locale: 'en');

      expect(page.nextToken, isEmpty);
      final [active, expired] = page.purchases;
      expect(active.id, 'purchase-active');
      expect(active.price, 500);
      expect(active.currency, 'USD');
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
      final call = server.requestsTo('ListMyPurchases').single;
      expect(call.headers['authorization'], 'Bearer $accessToken');
      final request = call.decode(pb.ListMyPurchasesRequest());
      expect(request.surface, appClientSurface);
      expect(request.limit, myPurchasePageLimit);
    });

    test('reads what was refunded and when the purchase closed', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        purchase('purchase-refunded', active: false)
          ..refundedAmount = 500
          ..refundedAt = '2026-01-11T12:00:00Z'
          ..revokedAt = '2026-01-11T12:00:00Z',
        purchase('purchase-canceled', active: false)
          ..revokedAt = '2026-01-12T12:00:00Z',
        purchase('purchase-active', active: true),
      ];

      final [refunded, canceled, active] = (await repository().listMyPurchases(
        locale: 'en',
      )).purchases;

      expect(refunded.refundedAmount, 500);
      expect(refunded.refundedAt?.toUtc(), DateTime.utc(2026, 1, 11, 12));
      expect(refunded.status, MyPurchaseStatus.refunded);
      expect(canceled.refundedAmount, 0);
      expect(canceled.refundedAt, isNull);
      expect(canceled.revokedAt?.toUtc(), DateTime.utc(2026, 1, 12, 12));
      expect(canceled.status, MyPurchaseStatus.canceled);
      expect(active.revokedAt, isNull);
      expect(active.status, MyPurchaseStatus.active);
    });

    test('names a volume and the rest of a series as such', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        pb.MyPurchase(
          id: 'purchase-volume',
          series: pb.Series(publicId: seriesId, title: 'Seed Series 001'),
          volume: pb.Volume(
            id: 'volume-1',
            publicId: 'VOLUME000001',
            title: 'Volume 1',
          ),
          priceAtPurchase: 350,
          currency: 'JPY',
          isActive: true,
        ),
        pb.MyPurchase(
          id: 'purchase-rest',
          series: pb.Series(publicId: seriesId, title: 'Seed Series 001'),
          seriesBundle: pb.SeriesBundle(id: 'bundle-1', episodeCount: 4),
          priceAtPurchase: 810,
          currency: 'JPY',
          isActive: true,
        ),
      ];

      final [volume, rest] = (await repository().listMyPurchases(
        locale: 'en',
      )).purchases;

      expect(volume.item, PurchasedItem.volume);
      expect(volume.volumeTitle, 'Volume 1');
      expect(volume.seriesId, seriesId);
      expect(volume.episodeId, isEmpty);
      expect(rest.item, PurchasedItem.remainingEpisodes);
      expect(rest.remainingEpisodeCount, 4);
      expect(rest.seriesId, seriesId);
    });

    test('names a pack by its coins and the tenant\'s word for them', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        pb.MyPurchase(
          id: 'purchase-pack',
          coinPack: pb.PurchasedCoinPack(
            id: 'pack-1',
            publicId: 'PACK00000001',
            coins: 1000,
            bonusCoins: 100,
          ),
          coinName: 'Points',
          priceAtPurchase: 1000,
          currency: 'JPY',
          purchasedAt: '2026-01-10T12:00:00Z',
          isActive: true,
          kind: pb.PurchaseKind.PURCHASE_KIND_PURCHASE,
        ),
      ];

      final [pack] = (await repository().listMyPurchases(
        locale: 'en',
      )).purchases;

      expect(pack.item, PurchasedItem.coinPack);
      expect(pack.coins, 1000);
      expect(pack.bonusCoins, 100);
      expect(pack.grantedCoins, 1100);
      expect(pack.coinName, 'Points');
      expect(pack.seriesId, isEmpty);
      expect(pack.seriesTitle, isEmpty);
      expect(pack.episodeId, isEmpty);
      expect(pack.price, 1000);
      expect(pack.status, MyPurchaseStatus.active);
    });

    test('tells a rental from the permanent copy', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        purchase(
          'purchase-rental',
          active: true,
          expiresAt: '2099-01-01T00:00:00Z',
        )..kind = pb.PurchaseKind.PURCHASE_KIND_RENTAL,
        purchase('purchase-copy', active: true)
          ..kind = pb.PurchaseKind.PURCHASE_KIND_PURCHASE,
      ];

      final [rental, copy] = (await repository().listMyPurchases(
        locale: 'en',
      )).purchases;

      expect(rental.kind, PurchaseKind.rental);
      expect(copy.kind, PurchaseKind.purchase);
    });

    test('asks for the page size it is given', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      await repository().listMyPurchases(
        limit: myPurchasePageLimitMax,
        locale: 'en',
      );

      expect(
        server.requestsOf(pb.ListMyPurchasesRequest.new).single.limit,
        myPurchasePageLimitMax,
      );
    });

    test('names the locale each title was served in', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myPurchases = [
        purchase('purchase-active', active: true)
          ..series.locale = 'ja'
          ..episode.locale = 'en',
      ];

      final [row] = (await repository().listMyPurchases(
        locale: 'en',
      )).purchases;

      expect(row.seriesLocale, 'ja');
      expect(row.episodeLocale, 'en');
    });

    test('asks in the reader\'s locale', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      await repository().listMyPurchases(locale: 'ko');

      expect(
        server.requestsOf(pb.ListMyPurchasesRequest.new).single.locale,
        'ko',
      );
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

      final first = await repository().listMyPurchases(locale: 'en');
      final second = await repository().listMyPurchases(
        token: first.nextToken,
        locale: 'en',
      );

      expect(first.purchases.map((item) => item.id), [
        'purchase-1',
        'purchase-2',
      ]);
      expect(second.purchases.map((item) => item.id), ['purchase-3']);
      expect(second.nextToken, isEmpty);
    });

    test('a reader who bought nothing is answered an empty page', () async {
      accessToken = ConnectFixtureServer.memberAccessToken;

      expect(
        (await repository().listMyPurchases(locale: 'en')).purchases,
        isEmpty,
      );
    });

    test('a guest is not sent to the API for it', () async {
      expect(
        (await repository().listMyPurchases(locale: 'en')).purchases,
        isEmpty,
      );
      expect(server.requestsTo('ListMyPurchases'), isEmpty);
    });

    test('a session the API refuses asks for a sign-in', () async {
      accessToken = 'a-token-the-api-no-longer-accepts';

      await expectLater(
        repository().listMyPurchases(locale: 'en'),
        failsWith(PurchaseFailureKind.sessionExpired),
      );
    });
  });
}
