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
  });

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

  /// The intent [startStorePurchase] opens for [episodePublicId].
  static String intentFor(String episodePublicId) =>
      'intent-$episodePublicId'.toLowerCase();

  /// What [acceptsPayments] answers.
  bool payments;

  /// What [seriesEpisodeAccess] answers, whichever series is asked about.
  Map<String, EpisodeAccess> access;

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

  /// The pages [listMyPurchases] answers, in order. The token of a page is
  /// its own index written out, the way the fixture server writes a cursor.
  List<List<MyPurchase>> pages;

  /// Thrown by [listMyPurchases].
  PurchaseFailure? listFailure;

  /// Thrown by [listMyPurchases] for every page but the first.
  PurchaseFailure? moreFailure;

  @override
  Future<bool> acceptsPayments() async => payments;

  @override
  Future<Map<String, EpisodeAccess>> seriesEpisodeAccess(
    String seriesPublicId,
  ) async => access;

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
  Future<Uri> startEpisodeCheckout(String episodePublicId) async {
    checkouts.add(episodePublicId);
    final failure = checkoutFailure;
    if (failure != null) {
      throw failure;
    }
    return checkoutUrlFor(episodePublicId);
  }

  @override
  Future<AppPurchaseRoute> appPurchaseRoute() async => route;

  @override
  Future<StorePurchaseIntent> startStorePurchase(
    String episodePublicId,
    InAppPurchaseStore store,
  ) async {
    storeIntents.add(episodePublicId);
    final failure = storeStartFailure;
    if (failure != null) {
      throw failure;
    }
    return StorePurchaseIntent(
      intentId: intentFor(episodePublicId),
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
  Future<MyPurchasePage> listMyPurchases({String token = ''}) async {
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

  static Uri checkoutUrlFor(String episodePublicId) =>
      Uri.parse('https://checkout.stripe.test/c/pay/$episodePublicId');
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
