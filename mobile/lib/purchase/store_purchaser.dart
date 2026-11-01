import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_subscriber.dart';

/// How a purchase through the store's payment sheet ended.
enum StorePurchaseOutcome {
  /// The server has recorded the purchase.
  purchased,

  /// The store took the order but has not settled it, or the server could not
  /// confirm it yet; it is confirmed once it can be.
  pending,

  /// The reader closed the payment sheet without paying.
  cancelled,
}

/// The store this device buys through, or `null` where there is none.
InAppPurchaseStore? deviceInAppPurchaseStore() {
  if (kIsWeb) {
    return null;
  }
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS => InAppPurchaseStore.appStore,
    TargetPlatform.android => InAppPurchaseStore.googlePlay,
    _ => null,
  };
}

/// Registers the [InAppPurchasePlatform] of the store this device buys
/// through and returns it, or returns `null` where there is none.
///
/// The app depends on the store plugins' implementations rather than on
/// `in_app_purchase`, the package that would otherwise register them: neither
/// declares a `dartPluginClass`, so the generated plugin registrant leaves
/// [InAppPurchasePlatform.instance] unset, and reading it throws.
InAppPurchasePlatform? registerDeviceInAppPurchasePlatform() {
  switch (deviceInAppPurchaseStore()) {
    case InAppPurchaseStore.appStore:
      InAppPurchaseStoreKitPlatform.registerPlatform();
    case InAppPurchaseStore.googlePlay:
      InAppPurchaseAndroidPlatform.registerPlatform();
    case null:
      return null;
  }
  return InAppPurchasePlatform.instance;
}

/// Buys an episode or a pack of the tenant's coins with the store's payment
/// sheet and hands every transaction the store reports to the server before
/// finishing it.
///
/// The transaction the store reports goes to `ConfirmStorePurchase`, and it
/// is finished only once the server has recorded it — consumed on Google
/// Play, so the same price can be bought again. One the app could not confirm
/// — no session, no network, a store that has not settled — stays with the
/// store, which reports it again on the next launch, and is confirmed again on
/// sign-in.
///
/// A transaction of a subscription is [StoreSubscriber]'s, which listens to
/// the same store, and is left to it.
class StorePurchaser {
  StorePurchaser({
    required this.platform,
    required this.store,
    required this.repository,
    this.isSubscription = _buysNoSubscription,
  });

  final InAppPurchasePlatform platform;
  final InAppPurchaseStore store;
  final PurchaseRepository repository;

  /// Whether a transaction is of a subscription, which this leaves alone:
  /// [StoreSubscriber.isSubscription] where the app sells plans.
  final Future<bool> Function(PurchaseDetails purchase) isSubscription;

  static Future<bool> _buysNoSubscription(PurchaseDetails _) async => false;

  StreamSubscription<List<PurchaseDetails>>? _subscription;

  final _recorded = StreamController<String>.broadcast();

  /// The product ID of each transaction as the server records it, whenever
  /// that is: a pending purchase, or one the server could not take at first,
  /// is recorded on a later resume or sign-in, long after the screen that
  /// sold it was told it is pending. A screen showing what such a purchase
  /// bought, such as a balance of coins, reads it again on hearing of one.
  Stream<String> get recorded => _recorded.stream;

  /// Transactions the server has not recorded yet, keyed by what is sent to
  /// it, and the confirmation of each one under way, so a transaction
  /// reported twice is confirmed once.
  final _unconfirmed = <String, PurchaseDetails>{};
  final _confirming = <String, Future<void>>{};

  _OpenPurchase? _open;

  /// Whether a purchase is between its tap and its outcome. It is taken
  /// before the first wait, so a second tap while the store is still being
  /// asked is refused rather than opening a second order over the first.
  var _buying = false;

  /// Starts listening to what the store reports. On iOS that is where the
  /// transactions an earlier run left unfinished arrive; Google Play reports
  /// them only when asked, so they are asked for here.
  Future<void> start() async {
    _subscription ??= platform.purchaseStream.listen(
      _onPurchases,
      onError: (Object _) {},
    );
    await _askForUnfinished();
  }

  /// Confirms again every transaction the server has not recorded, and
  /// returns once none is being confirmed any more. A sign-in, a resume, and
  /// a reader checking a pending purchase again call it, because a
  /// transaction the server could not take then is taken only by asking again.
  Future<void> reconcile() async {
    for (final purchase in _unconfirmed.values.toList()) {
      await _confirm(purchase);
    }
    await _askForUnfinished();
    // What Google Play reported arrives on the stream after the call that
    // asked for it has returned.
    await Future<void>.delayed(Duration.zero);
    await Future.wait(_confirming.values.toList());
  }

  Future<void> dispose() async {
    await _subscription?.cancel();
    _subscription = null;
    await _recorded.close();
  }

  Future<void> _askForUnfinished() async {
    if (store != InAppPurchaseStore.googlePlay) {
      return;
    }
    try {
      await platform.restorePurchases();
    } on Object {
      // A device with no Play services has nothing to report.
    }
  }

  /// Opens the payment sheet for the episode [episodeInternalId] names.
  ///
  /// `StartStorePurchase` answers with an intent and the product the
  /// episode's price is sold as, and the sheet is opened for that product
  /// with the intent as `appAccountToken` (iOS, StoreKit 2) or
  /// `obfuscatedAccountId` (Android). A purchase the store holds for approval
  /// is shown as being confirmed.
  ///
  /// Throws [PurchaseFailure]: [PurchaseFailureKind.storeUnavailable] when the
  /// device cannot pay, [PurchaseFailureKind.notSold] when the store has no
  /// product for the episode, and whatever [PurchaseRepository] throws.
  Future<StorePurchaseOutcome> buy(String episodeInternalId) =>
      _buy(() => repository.startStorePurchase(episodeInternalId, store));

  /// Opens the payment sheet for the pack of the tenant's coins [coinPackId]
  /// names, as [buy] does for an episode. The server grants the coins once it
  /// has recorded the transaction, which is when this answers
  /// [StorePurchaseOutcome.purchased].
  Future<StorePurchaseOutcome> buyCoinPack(String coinPackId) =>
      _buy(() => repository.startCoinPackStorePurchase(coinPackId, store));

  /// The price the store sells each of [productIds] at, formatted by the
  /// store for the reader's storefront, keyed by product ID. A product the
  /// store does not have is left out, and so is every one on a device that
  /// cannot pay.
  Future<Map<String, String>> prices(Set<String> productIds) async {
    if (productIds.isEmpty || !await _isAvailable()) {
      return const {};
    }
    final ProductDetailsResponse response;
    try {
      response = await platform.queryProductDetails(productIds);
    } on PlatformException {
      return const {};
    }
    return Map.unmodifiable({
      for (final product in response.productDetails)
        if (productIds.contains(product.id)) product.id: product.price,
    });
  }

  Future<StorePurchaseOutcome> _buy(
    Future<StorePurchaseIntent> Function() start,
  ) async {
    if (_buying) {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'a purchase is already open',
      );
    }
    _buying = true;
    try {
      return await _buyOnce(start);
    } finally {
      _buying = false;
    }
  }

  Future<StorePurchaseOutcome> _buyOnce(
    Future<StorePurchaseIntent> Function() start,
  ) async {
    if (!await _isAvailable()) {
      throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
    }
    // Both stores refuse a second order of a product they still hold an
    // unfinished transaction of, so one the server can take now is cleared
    // before a new order of the same price.
    await reconcile();
    final intent = await start();
    final product = await _product(intent.productId);
    final open = _OpenPurchase(intent);
    _open = open;
    try {
      final launched = await platform.buyConsumable(
        purchaseParam: PurchaseParam(
          productDetails: product,
          // `appAccountToken` on iOS, `obfuscatedAccountId` on Android.
          applicationUserName: intent.intentId,
        ),
        // Google Play would consume the purchase before the server has it;
        // StoreKit refuses anything but true and finishes nothing by it.
        autoConsume: store == InAppPurchaseStore.appStore,
      );
      if (!launched) {
        throw const PurchaseFailure(
          PurchaseFailureKind.unexpected,
          message: 'the payment sheet did not open',
        );
      }
      return await open.outcome.future;
    } on PlatformException catch (error) {
      throw PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: error.code,
      );
    } finally {
      if (identical(_open, open)) {
        _open = null;
      }
    }
  }

  Future<bool> _isAvailable() async {
    try {
      return await platform.isAvailable();
    } on PlatformException {
      return false;
    }
  }

  Future<ProductDetails> _product(String productId) async {
    final ProductDetailsResponse response;
    try {
      response = await platform.queryProductDetails({productId});
    } on PlatformException catch (error) {
      throw PurchaseFailure(
        PurchaseFailureKind.storeUnavailable,
        message: error.code,
      );
    }
    for (final product in response.productDetails) {
      if (product.id == productId) {
        return product;
      }
    }
    throw PurchaseFailure(
      PurchaseFailureKind.notSold,
      message: 'the store has no product $productId',
    );
  }

  void _onPurchases(List<PurchaseDetails> purchases) {
    for (final purchase in purchases) {
      switch (purchase.status) {
        case PurchaseStatus.pending:
          _settle(purchase, StorePurchaseOutcome.pending);
        case PurchaseStatus.canceled:
          _settle(purchase, StorePurchaseOutcome.cancelled);
        case PurchaseStatus.error:
          _fail(
            purchase,
            PurchaseFailure(
              PurchaseFailureKind.unexpected,
              message: purchase.error?.code ?? '',
            ),
          );
        case PurchaseStatus.purchased || PurchaseStatus.restored:
          unawaited(_confirm(purchase));
      }
    }
  }

  Future<void> _confirm(PurchaseDetails purchase) {
    final transaction = purchase.verificationData.serverVerificationData;
    if (transaction.isEmpty) {
      return Future.value();
    }
    return _confirming[transaction] ??= _confirmOnce(purchase, transaction)
        .whenComplete(() {
          _confirming.remove(transaction);
        });
  }

  Future<void> _confirmOnce(
    PurchaseDetails purchase,
    String transaction,
  ) async {
    if (await _leftToSubscriber(purchase)) {
      return;
    }
    _unconfirmed[transaction] = purchase;
    try {
      await repository.confirmStorePurchase(
        store: store,
        transaction: transaction,
        productId: purchase.productID,
      );
    } on PurchaseFailure catch (failure) {
      // The store keeps the transaction, and it is confirmed again later.
      switch (failure.kind) {
        case PurchaseFailureKind.notSettled || PurchaseFailureKind.network:
          _settle(purchase, StorePurchaseOutcome.pending);
        case _:
          _fail(purchase, failure);
      }
      return;
    }
    _unconfirmed.remove(transaction);
    if (!_recorded.isClosed) {
      _recorded.add(purchase.productID);
    }
    try {
      await _finish(purchase);
    } on Object {
      // The server has the purchase. The store reports the transaction again,
      // the server answers it with the same purchase, and it is finished then.
    }
    _settle(purchase, StorePurchaseOutcome.purchased);
  }

  Future<bool> _leftToSubscriber(PurchaseDetails purchase) async {
    try {
      return await isSubscription(purchase);
    } on Object {
      return false;
    }
  }

  /// Finishes a transaction the server has recorded. A Google Play purchase is
  /// consumed rather than acknowledged, so the same price can be bought again
  /// for another episode, and the same pack again.
  Future<void> _finish(PurchaseDetails purchase) async {
    final addition = InAppPurchasePlatformAddition.instance;
    if (addition is InAppPurchaseAndroidPlatformAddition) {
      await addition.consumePurchase(purchase);
      return;
    }
    await platform.completePurchase(purchase);
  }

  /// The open purchase [purchase] answers. A transaction carries the intent
  /// it was bought for, which tells an earlier order of the same price apart;
  /// a pending or cancelled order the store reports without a transaction is
  /// matched by its product, and one Google Play reports without a purchase
  /// names no product either.
  _OpenPurchase? _openFor(PurchaseDetails purchase) {
    final open = _open;
    if (open == null || open.outcome.isCompleted) {
      return null;
    }
    final token = _accountToken(purchase);
    if (token.isNotEmpty) {
      return token == open.intent.intentId.toLowerCase() ? open : null;
    }
    final productId = purchase.productID;
    return productId.isEmpty || productId == open.intent.productId
        ? open
        : null;
  }

  /// StoreKit writes the UUID it was handed in capitals.
  String _accountToken(PurchaseDetails purchase) {
    final token = switch (purchase) {
      SK2PurchaseDetails(:final appAccountToken) => appAccountToken,
      GooglePlayPurchaseDetails(:final billingClientPurchase) =>
        billingClientPurchase.obfuscatedAccountId,
      _ => null,
    };
    return (token ?? '').toLowerCase();
  }

  void _settle(PurchaseDetails purchase, StorePurchaseOutcome outcome) {
    _openFor(purchase)?.outcome.complete(outcome);
  }

  void _fail(PurchaseDetails purchase, PurchaseFailure failure) {
    _openFor(purchase)?.outcome.completeError(failure);
  }
}

class _OpenPurchase {
  _OpenPurchase(this.intent);

  final StorePurchaseIntent intent;
  final outcome = Completer<StorePurchaseOutcome>();
}
