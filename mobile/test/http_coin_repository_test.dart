import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/coin.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/coins/http_coin_repository.dart';
import 'package:publira/models/my_purchase.dart';

import 'support/connect_fixture_server.dart';

void main() {
  final episodeInternalId = ConnectFixtureServer.internalIdOf(
    ConnectFixtureServer.paidEpisodeId,
  );

  late ConnectFixtureServer server;
  late String accessToken;

  HttpCoinRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpCoinRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  Matcher failsWith(CoinFailureKind kind) => throwsA(
    isA<CoinFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  setUp(() async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server = ConnectFixtureServer()
      ..coinSettings = pb.CoinSettings(
        coinName: 'Points',
        coinUnitAmount: 10,
        currency: 'JPY',
        expiryDays: 180,
        selling: true,
        packs: [
          pb.CoinPack(
            id: '0190a0a0-0000-7000-8000-000000000001',
            publicId: 'PACK0001',
            coins: 100,
            bonusCoins: 10,
            price: 1000,
            currency: 'JPY',
          ),
        ],
        disclosures: pb.CoinDisclosures(
          issuerName: 'Example Publishing',
          termsUrl: 'https://example.com/terms',
          contact: 'support@example.com',
          notice: 'Unused Points are not refunded.',
        ),
      )
      ..coinBalance = pb.CoinBalance(
        coins: Int64(120),
        coinName: 'Points',
        nearestExpiryAt: '2027-04-24T03:00:00Z',
        nearestExpiryCoins: Int64(120),
        shortfallCoins: Int64(5),
      );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('the settings name the coins in the locale asked', () async {
    final settings = await repository().settings(locale: 'ja');

    expect(settings.coinName, 'Points');
    expect(settings.expiryDays, 180);
    expect(settings.selling, isTrue);
    final pack = settings.packs.single;
    expect(pack.coins, 100);
    expect(pack.bonusCoins, 10);
    expect(pack.totalCoins, 110);
    expect(pack.productId, 'coins_0190a0a0000070008000000000000001');
    expect(settings.disclosures.issuerName, 'Example Publishing');
    expect(
      settings.disclosures.termsUrl,
      Uri.parse('https://example.com/terms'),
    );
    expect(
      server.requestsOf(pb.GetCoinSettingsRequest.new).single.locale,
      'ja',
    );
  });

  test('terms that are not a web address are not offered', () async {
    server.coinSettings!.disclosures.termsUrl = 'javascript:alert(1)';

    final settings = await repository().settings(locale: 'en');

    expect(settings.disclosures.termsUrl, isNull);
  });

  test('a tenant with coins off is answered as unavailable', () async {
    server.coinSettings = null;

    await expectLater(
      repository().settings(locale: 'en'),
      failsWith(CoinFailureKind.unavailable),
    );
    await expectLater(
      repository().balance(locale: 'en'),
      failsWith(CoinFailureKind.unavailable),
    );
  });

  test('the balance is the signed-in reader\'s', () async {
    final balance = await repository().balance(locale: 'en');

    expect(balance.coins, 120);
    expect(balance.coinName, 'Points');
    expect(balance.nearestExpiryAt, DateTime.utc(2027, 4, 24, 3).toLocal());
    expect(balance.nearestExpiryCoins, 120);
    expect(balance.owedCoins, 5);
    final call = server.requestsTo('GetCoinBalance').single;
    expect(call.headers['authorization'], 'Bearer $accessToken');
  });

  test('a guest is not sent to the API for a balance', () async {
    accessToken = '';

    await expectLater(
      repository().balance(locale: 'en'),
      failsWith(CoinFailureKind.sessionExpired),
    );
    expect(server.requestsTo('GetCoinBalance'), isEmpty);
  });

  test('the history pages through what the API answers', () async {
    server.coinTransactions = [
      pb.CoinTransaction(
        id: 'spend-1',
        kind: pb.CoinTransactionKind.COIN_TRANSACTION_KIND_SPEND,
        coins: 50,
        createdAt: '2026-10-25T00:00:00Z',
        purchaseId: 'purchase-1',
        episode: pb.Episode(publicId: 'EPSD0001', title: 'Episode 3'),
        series: pb.Series(publicId: 'SERS0001', title: 'Series'),
      ),
      pb.CoinTransaction(
        id: 'grant-1',
        kind: pb.CoinTransactionKind.COIN_TRANSACTION_KIND_GRANT,
        coins: 170,
        createdAt: '2026-10-24T00:00:00Z',
        expiresAt: '2027-04-22T00:00:00Z',
      ),
      pb.CoinTransaction(
        id: 'expiry-1',
        kind: pb.CoinTransactionKind.COIN_TRANSACTION_KIND_EXPIRY,
        coins: 10,
        createdAt: '2026-10-23T00:00:00Z',
      ),
    ];

    final first = await repository().transactions(locale: 'en');
    expect(first.coinName, 'Points');
    expect(first.transactions.map((entry) => entry.kind), [
      CoinTransactionKind.spend,
      CoinTransactionKind.grant,
    ]);
    final spend = first.transactions.first;
    expect(spend.seriesId, 'SERS0001');
    expect(spend.episodeId, 'EPSD0001');
    expect(spend.episodeTitle, 'Episode 3');
    expect(first.transactions.last.expiresAt, isNotNull);
    expect(first.nextToken, '2');

    final second = await repository().transactions(
      locale: 'en',
      token: first.nextToken,
    );
    expect(second.transactions.single.kind, CoinTransactionKind.expiry);
    expect(second.nextToken, isEmpty);
    final requests = server.requestsOf(pb.ListCoinTransactionsRequest.new);
    expect(
      requests.map((request) => request.surface),
      everyElement(appClientSurface),
    );
    expect(requests.last.token, '2');
  });

  test('a payment spends the price shown under the key it was given', () async {
    final balance = await repository().payEpisode(
      episodeInternalId,
      coins: 50,
      idempotencyKey: 'key-1',
      locale: 'en',
      kind: PurchaseKind.rental,
    );

    expect(balance.coins, 70);
    final request = server.requestsOf(pb.PayEpisodeWithCoinsRequest.new).single;
    expect(request.episodeId, episodeInternalId);
    expect(request.coins, 50);
    expect(request.idempotencyKey, 'key-1');
    expect(request.kind, pb.PurchaseKind.PURCHASE_KIND_RENTAL);
    expect(request.surface, appClientSurface);
  });

  test('a payment is refused by the reason the API names', () async {
    server.coinPaymentRefusal = 'COIN_PRICE_CHANGED';
    await expectLater(
      repository().payEpisode(
        episodeInternalId,
        coins: 50,
        idempotencyKey: 'key-1',
        locale: 'en',
      ),
      failsWith(CoinFailureKind.priceChanged),
    );

    server.coinPaymentRefusal = null;
    await expectLater(
      repository().payEpisode(
        episodeInternalId,
        coins: 500,
        idempotencyKey: 'key-2',
        locale: 'en',
      ),
      failsWith(CoinFailureKind.insufficient),
    );
  });
}
