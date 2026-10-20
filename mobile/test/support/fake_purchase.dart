import 'dart:async';

import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
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

  /// What [appPurchaseRoute] answers.
  AppPurchaseRoute route;

  /// The product [startStorePurchase] answers every episode with.
  String storeProductId = 'episode_500';

  /// Thrown by [startStorePurchase].
  PurchaseFailure? storeStartFailure;

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

  /// Internal ids of the episodes [seriesEpisodeAccess] answers as owned.
  Set<String> owned = const {};

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
  Future<SeriesPurchaseState> seriesEpisodeAccess(
    String seriesInternalId,
  ) async {
    accessReads++;
    final answer = SeriesPurchaseState(
      access: access,
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
  }) async {
    checkouts.add(episodeInternalId);
    checkoutLocales.add(locale);
    checkoutKinds.add(kind);
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

  /// Series [startSeriesRemainderCheckout] was asked for, in order.
  final List<String> remainderCheckouts = <String>[];

  /// The locale each call to [startSeriesRemainderCheckout] asked in, in
  /// order.
  final List<String> remainderCheckoutLocales = <String>[];

  @override
  Future<Uri> startVolumeCheckout(String volumeInternalId) async {
    volumeCheckouts.add(volumeInternalId);
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
    InAppPurchaseStore store,
  ) async {
    storeIntents.add(episodeInternalId);
    final failure = storeStartFailure;
    if (failure != null) {
      throw failure;
    }
    return StorePurchaseIntent(
      intentId: intentFor(episodeInternalId),
      productId: storeProductId,
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
    onConfirmed?.call();
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
