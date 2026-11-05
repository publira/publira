import 'dart:async';

import 'package:publira/coins/coin_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/models/tenant_invoice.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// In-memory [PurchaseRepository] for widget tests.
class FakePurchaseRepository implements PurchaseRepository {
  FakePurchaseRepository({
    this.payments = true,
    this.access = const {},
    this.seriesByEpisode = const {},
    this.checkoutFailure,
    this.pages = const [],
    this.route = AppPurchaseRoute.externalCheckout,
    this.tenantCurrency = 'JPY',
  });

  /// What [currency] answers.
  String tenantCurrency;

  /// What [invoice] answers.
  TenantInvoice tenantInvoice = TenantInvoice.none;

  /// Thrown by [invoice], standing in for an API that cannot answer.
  PurchaseFailure? invoiceFailure;

  /// What [appPurchaseRoute] answers.
  AppPurchaseRoute route;

  /// The product [startStorePurchase] answers every episode with.
  String storeProductId = 'episode_500';

  /// The product [startStorePurchase] answers a purchase with a code with.
  String promotionStoreProductId = 'episode_400';

  /// Whether a code takes the whole price off, which [startStorePurchase]
  /// answers as a purchase recorded at once.
  bool storeRecordsPromotionCode = false;

  /// The code each call to [startStorePurchase] carried, in order.
  final List<String> storePromotionCodes = <String>[];

  /// Thrown by [startStorePurchase].
  PurchaseFailure? storeStartFailure;

  /// Held open by a test that needs [startStorePurchase] in flight.
  Completer<void>? storeStartGate;

  /// Episodes [startStorePurchase] was asked for, in order.
  final List<String> storeIntents = <String>[];

  /// Thrown by [confirmStorePurchase], standing in for a server that cannot
  /// record the transaction yet.
  PurchaseFailure? confirmFailure;

  /// Held open by a test that needs a confirmation in flight.
  Completer<void>? confirmGate;

  /// Called for a transaction [confirmStorePurchase] records, which is when
  /// the server starts answering the episode as the reader's.
  void Function()? onConfirmed;

  /// Transactions [confirmStorePurchase] recorded, in order.
  final List<String> confirmed = <String>[];

  /// The intent [startStorePurchase] opens for [episodeInternalId].
  static String intentFor(String episodeInternalId) =>
      'intent-$episodeInternalId'.toLowerCase();

  /// What [acceptsPayments] answers.
  bool payments;

  /// What [seriesEpisodeAccess] answers, whichever series is asked about.
  Map<String, EpisodeAccess> access;

  /// Why [seriesEpisodeAccess] answers each entitled episode open, keyed by
  /// episode public id.
  Map<String, EpisodeEntitlementSource> sources = const {};

  /// Internal ids of the episodes [seriesEpisodeAccess] answers as owned.
  Set<String> owned = const {};

  /// What [subscriptionPlans] answers.
  List<SubscriptionPlan> plans = const [];

  /// Thrown by [subscriptionPlans], standing in for an API that cannot
  /// answer.
  PurchaseFailure? plansFailure;

  /// What [mySubscription] answers.
  MySubscription? subscription;

  /// Thrown by [mySubscription], standing in for an API that cannot answer.
  PurchaseFailure? subscriptionFailure;

  /// How many times [mySubscription] was asked.
  var subscriptionReads = 0;

  /// The page [startBillingPortal] answers.
  Uri portalUrl = Uri.parse('https://billing.stripe.test/p/session/reader');

  /// Thrown by [startBillingPortal].
  PurchaseFailure? portalFailure;

  /// How many times [startBillingPortal] was asked.
  var portalStarts = 0;

  /// The quote of the rest of the series [seriesEpisodeAccess] answers.
  SeriesRemainderOffer? remainder;

  /// Thrown by [seriesEpisodeAccess], standing in for an API that cannot
  /// answer.
  PurchaseFailure? accessFailure;

  /// How many times [seriesEpisodeAccess] was asked.
  var accessReads = 0;

  /// Held open by a test that needs a read of [seriesEpisodeAccess] in
  /// flight. The read answers [access] as it was when the read was asked.
  Completer<void>? accessGate;

  /// What [seriesOfEpisode] answers from, looked up by episode public id.
  Map<String, String> seriesByEpisode;

  /// Thrown by [seriesOfEpisode], standing in for an API that cannot answer.
  PurchaseFailure? seriesFailure;

  /// Held open by a test that needs a lookup of [seriesOfEpisode] in flight.
  Completer<void>? seriesGate;

  /// Thrown by [startEpisodeCheckout].
  PurchaseFailure? checkoutFailure;

  /// Episodes [startEpisodeCheckout] was asked for, in order.
  final List<String> checkouts = <String>[];

  /// The locale each call to [startEpisodeCheckout] asked in, in order.
  final List<String> checkoutLocales = <String>[];

  /// The sale each call to [startEpisodeCheckout] asked for, in order.
  final List<PurchaseKind> checkoutKinds = <PurchaseKind>[];

  /// The code each call to [startEpisodeCheckout] carried, in order.
  final List<String> checkoutPromotionCodes = <String>[];

  /// What [acceptsPromotionCodes] answers.
  bool promotionCodes = false;

  /// What [previewPromotionCode] answers for each sale, a sale missing from
  /// it answered as not applying.
  Map<PromotionCodeSale, PromotionCodeQuote> promotionQuotes = const {};

  /// Thrown by [previewPromotionCode].
  PurchaseFailure? promotionFailure;

  /// Held open by a test that needs [previewPromotionCode] in flight.
  Completer<void>? promotionGate;

  /// Every call to [previewPromotionCode], in order.
  final List<({String code, List<PromotionCodeSale> sales, bool store})>
  promotionPreviews = [];

  /// The pages [listMyPurchases] answers, in order. The token of a page is
  /// its own index written out, the way the fixture server writes a cursor.
  List<List<MyPurchase>> pages;

  /// The `limit` each call to [listMyPurchases] asked for, in order.
  final List<int> limits = <int>[];

  /// The locale each call to [listMyPurchases] asked in, in order.
  final List<String> listLocales = <String>[];

  /// Held open by a test that changes something while a page is on its way:
  /// [listMyPurchases] answers once it completes.
  Completer<void>? listGate;

  /// Thrown by [listMyPurchases].
  PurchaseFailure? listFailure;

  /// Thrown by [listMyPurchases] for every page but the first.
  PurchaseFailure? moreFailure;

  @override
  Future<bool> acceptsPayments() async => payments;

  @override
  Future<String> currency() async => tenantCurrency;

  @override
  Future<bool> acceptsPromotionCodes() async => promotionCodes;

  @override
  Future<List<PromotionCodeQuote>> previewPromotionCode(
    String code,
    List<PromotionCodeSale> sales, {
    bool store = false,
  }) async {
    promotionPreviews.add((code: code, sales: sales, store: store));
    await promotionGate?.future;
    if (promotionFailure case final failure?) {
      throw failure;
    }
    return [
      for (final sale in sales)
        promotionQuotes[sale] ??
            const PromotionCodeQuote(
              listPrice: 0,
              price: 0,
              refusal: PromotionCodeSaleRefusal.notApplicable,
            ),
    ];
  }

  @override
  Future<TenantInvoice> invoice() async {
    if (invoiceFailure case final failure?) {
      throw failure;
    }
    return tenantInvoice;
  }

  @override
  Future<SeriesPurchaseState> seriesEpisodeAccess(
    String seriesInternalId,
  ) async {
    accessReads++;
    final answer = SeriesPurchaseState(
      access: access,
      entitlementSources: sources,
      ownedEpisodeIds: owned,
      remainder: remainder,
    );
    final failure = accessFailure;
    await accessGate?.future;
    if (failure != null) {
      throw failure;
    }
    return answer;
  }

  @override
  Future<List<SubscriptionPlan>> subscriptionPlans() async {
    final failure = plansFailure;
    if (failure != null) {
      throw failure;
    }
    return plans;
  }

  @override
  Future<MySubscription?> mySubscription() async {
    subscriptionReads++;
    final failure = subscriptionFailure;
    if (failure != null) {
      throw failure;
    }
    return subscription;
  }

  @override
  Future<Uri> startBillingPortal() async {
    portalStarts++;
    final failure = portalFailure;
    if (failure != null) {
      throw failure;
    }
    return portalUrl;
  }

  @override
  Future<String?> seriesOfEpisode(String episodePublicId) async {
    await seriesGate?.future;
    final failure = seriesFailure;
    if (failure != null) {
      throw failure;
    }
    return seriesByEpisode[episodePublicId];
  }

  @override
  Future<Uri> startEpisodeCheckout(
    String episodeInternalId, {
    required String locale,
    PurchaseKind kind = PurchaseKind.purchase,
    String promotionCode = '',
  }) async {
    checkouts.add(episodeInternalId);
    checkoutLocales.add(locale);
    checkoutKinds.add(kind);
    checkoutPromotionCodes.add(promotionCode);
    final failure = checkoutFailure;
    if (failure != null) {
      throw failure;
    }
    return checkoutUrlFor(episodeInternalId);
  }

  /// Thrown by [startVolumeCheckout] and [startSeriesRemainderCheckout].
  PurchaseFailure? bundleCheckoutFailure;

  /// Volumes [startVolumeCheckout] was asked for, in order.
  final List<String> volumeCheckouts = <String>[];

  /// The code each call to [startVolumeCheckout] carried, in order.
  final List<String> volumePromotionCodes = <String>[];

  /// Series [startSeriesRemainderCheckout] was asked for, in order.
  final List<String> remainderCheckouts = <String>[];

  /// The locale each call to [startSeriesRemainderCheckout] asked in, in
  /// order.
  final List<String> remainderCheckoutLocales = <String>[];

  @override
  Future<Uri> startVolumeCheckout(
    String volumeInternalId, {
    String promotionCode = '',
  }) async {
    volumeCheckouts.add(volumeInternalId);
    volumePromotionCodes.add(promotionCode);
    final failure = bundleCheckoutFailure;
    if (failure != null) {
      throw failure;
    }
    return checkoutUrlFor(volumeInternalId);
  }

  @override
  Future<Uri> startSeriesRemainderCheckout(
    String seriesInternalId, {
    required String locale,
  }) async {
    remainderCheckouts.add(seriesInternalId);
    remainderCheckoutLocales.add(locale);
    final failure = bundleCheckoutFailure;
    if (failure != null) {
      throw failure;
    }
    return checkoutUrlFor(seriesInternalId);
  }

  @override
  Future<AppPurchaseRoute> appPurchaseRoute() async => route;

  @override
  Future<StorePurchaseIntent> startStorePurchase(
    String episodeInternalId,
    InAppPurchaseStore store, {
    String promotionCode = '',
  }) async {
    storeIntents.add(episodeInternalId);
    storePromotionCodes.add(promotionCode);
    await storeStartGate?.future;
    final failure = storeStartFailure;
    if (failure != null) {
      throw failure;
    }
    if (promotionCode.isNotEmpty) {
      if (storeRecordsPromotionCode) {
        return const StorePurchaseIntent.recorded();
      }
      return StorePurchaseIntent(
        intentId: intentFor(episodeInternalId),
        productId: promotionStoreProductId,
      );
    }
    return StorePurchaseIntent(
      intentId: intentFor(episodeInternalId),
      productId: storeProductId,
    );
  }

  /// The episode and amount of each tip [startTipCheckout] was asked for, in
  /// order, as `episodeInternalId:amount`.
  final List<String> tipCheckouts = <String>[];

  /// The locale each call to [startTipCheckout] asked in, in order.
  final List<String> tipCheckoutLocales = <String>[];

  /// Thrown by [startTipCheckout].
  PurchaseFailure? tipCheckoutFailure;

  @override
  Future<Uri> startTipCheckout(
    String episodeInternalId, {
    required int amount,
    required String locale,
  }) async {
    tipCheckouts.add('$episodeInternalId:$amount');
    tipCheckoutLocales.add(locale);
    final failure = tipCheckoutFailure;
    if (failure != null) {
      throw failure;
    }
    return tipCheckoutUrlFor(episodeInternalId, amount);
  }

  static Uri tipCheckoutUrlFor(String episodeInternalId, int amount) =>
      Uri.parse(
        'https://checkout.stripe.test/c/tip/$episodeInternalId/$amount',
      );

  /// The episode and amount of each tip [startStoreTip] was asked for, in
  /// order, as `episodeInternalId:amount`.
  final List<String> tipIntents = <String>[];

  /// Thrown by [startStoreTip].
  PurchaseFailure? tipStartFailure;

  /// Called for a tip transaction [confirmStorePurchase] records.
  void Function(String productId)? onTipConfirmed;

  /// The intent [startStoreTip] opens for a tip of [amount] to the Authors of
  /// [episodeInternalId].
  static String tipIntentFor(String episodeInternalId, int amount) =>
      'tip-intent-$episodeInternalId-$amount'.toLowerCase();

  @override
  Future<StorePurchaseIntent> startStoreTip(
    String episodeInternalId, {
    required int amount,
    required InAppPurchaseStore store,
  }) async {
    tipIntents.add('$episodeInternalId:$amount');
    final failure = tipStartFailure;
    if (failure != null) {
      throw failure;
    }
    return StorePurchaseIntent(
      intentId: tipIntentFor(episodeInternalId, amount),
      productId: 'tip_$amount',
    );
  }

  /// Packs [startCoinPackStorePurchase] was asked for, in order.
  final List<String> coinPackIntents = <String>[];

  /// Called for a pack transaction [confirmStorePurchase] records, which is
  /// when the server grants its coins.
  void Function(String productId)? onCoinPackConfirmed;

  @override
  Future<StorePurchaseIntent> startCoinPackStorePurchase(
    String coinPackId,
    InAppPurchaseStore store,
  ) async {
    coinPackIntents.add(coinPackId);
    final failure = storeStartFailure;
    if (failure != null) {
      throw failure;
    }
    return StorePurchaseIntent(
      intentId: intentFor(coinPackId),
      productId: coinPackProductId(coinPackId),
    );
  }

  @override
  Future<void> confirmStorePurchase({
    required InAppPurchaseStore store,
    required String transaction,
    required String productId,
  }) async {
    await confirmGate?.future;
    final failure = confirmFailure;
    if (failure != null) {
      throw failure;
    }
    confirmed.add(transaction);
    if (productId.startsWith('coins_')) {
      onCoinPackConfirmed?.call(productId);
      return;
    }
    if (productId.startsWith('tip_')) {
      onTipConfirmed?.call(productId);
      return;
    }
    onConfirmed?.call();
  }

  /// Plans [startStoreSubscription] was asked for, in order.
  final List<String> subscriptionIntents = <String>[];

  /// What [startStoreSubscription] throws, if anything.
  PurchaseFailure? subscriptionStartFailure;

  /// Holds [startStoreSubscription] until completed, while the server is
  /// still being asked.
  Completer<void>? subscriptionStartGate;

  /// Transactions [confirmStoreSubscription] recorded, in order.
  final List<String> subscriptionsConfirmed = <String>[];

  /// What [confirmStoreSubscription] throws, if anything: a subscription the
  /// server holds for another account, or a store it could not reach.
  PurchaseFailure? subscriptionConfirmFailure;

  /// Called for each subscription [confirmStoreSubscription] records, which
  /// is when the server opens the plan's episodes to the reader.
  void Function(String productId)? onSubscriptionConfirmed;

  /// The intent [startStoreSubscription] answers for [planId].
  static String subscriptionIntentFor(String planId) =>
      'subscription-intent-$planId'.toLowerCase();

  @override
  Future<StorePurchaseIntent> startStoreSubscription(
    String planId,
    InAppPurchaseStore store,
  ) async {
    subscriptionIntents.add(planId);
    await subscriptionStartGate?.future;
    final failure = subscriptionStartFailure;
    if (failure != null) {
      throw failure;
    }
    final plan = plans.firstWhere((plan) => plan.id == planId);
    return StorePurchaseIntent(
      intentId: subscriptionIntentFor(planId),
      productId: plan.productIdIn(store),
    );
  }

  @override
  Future<void> confirmStoreSubscription({
    required InAppPurchaseStore store,
    required String transaction,
    required String productId,
  }) async {
    final failure = subscriptionConfirmFailure;
    if (failure != null) {
      throw failure;
    }
    subscriptionsConfirmed.add(transaction);
    onSubscriptionConfirmed?.call(productId);
  }

  @override
  Future<MyPurchasePage> listMyPurchases({
    required String locale,
    String token = '',
    int limit = myPurchasePageLimit,
  }) async {
    limits.add(limit);
    listLocales.add(locale);
    await listGate?.future;
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    final more = moreFailure;
    if (more != null && token.isNotEmpty) {
      throw more;
    }
    final index = token.isEmpty ? 0 : int.parse(token);
    if (index >= pages.length) {
      return MyPurchasePage.empty;
    }
    return MyPurchasePage(
      purchases: pages[index],
      nextToken: index + 1 < pages.length ? '${index + 1}' : '',
    );
  }

  static Uri checkoutUrlFor(String episodeInternalId) =>
      Uri.parse('https://checkout.stripe.test/c/pay/$episodeInternalId');
}

/// A [CheckoutLauncher] a test reads, so a purchase can be asserted without a
/// browser.
class FakeCheckoutLauncher implements CheckoutLauncher {
  FakeCheckoutLauncher({this.opens = true});

  /// What [open] answers.
  bool opens;

  final List<Uri> opened = <Uri>[];

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return opens;
  }
}
