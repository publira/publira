import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

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

/// Buys an episode with the store's payment sheet and hands every transaction
/// the store reports to the server before finishing it.
///
/// A transaction is finished only once the server has recorded it, so one the
/// app could not confirm — no session, no network, a store that has not
/// settled — stays with the store, which reports it again on the next launch,
/// and is confirmed again on sign-in.
class StorePurchaser {
  StorePurchaser({
    required this.platform,
    required this.store,
    required this.repository,
  });

  final InAppPurchasePlatform platform;
  final InAppPurchaseStore store;
  final PurchaseRepository repository;

  StreamSubscription<List<PurchaseDetails>>? _subscription;

  /// Transactions the server has not recorded yet, keyed by what is sent to
  /// it, and the confirmation of each one under way, so a transaction
  /// reported twice is confirmed once.
  final _unconfirmed = <String, PurchaseDetails>{};
  final _confirming = <String, Future<void>>{};

  _OpenPurchase? _open;

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

  /// Opens the payment sheet for [episodePublicId].
  ///
  /// Throws [PurchaseFailure]: [PurchaseFailureKind.storeUnavailable] when the
  /// device cannot pay, [PurchaseFailureKind.notSold] when the store has no
  /// product for the episode, and whatever [PurchaseRepository] throws.
  Future<StorePurchaseOutcome> buy(String episodePublicId) async {
    if (_open != null) {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'a purchase is already open',
      );
    }
    if (!await _isAvailable()) {
      throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
    }
    // Both stores refuse a second order of a product they still hold an
    // unfinished transaction of, so one the server can take now is cleared
    // before a new order of the same price.
    await reconcile();
    final intent = await repository.startStorePurchase(episodePublicId, store);
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
    try {
      await _finish(purchase);
    } on Object {
      // The server has the purchase. The store reports the transaction again,
      // the server answers it with the same purchase, and it is finished then.
    }
    _settle(purchase, StorePurchaseOutcome.purchased);
  }

  /// Finishes a transaction the server has recorded. A Google Play purchase is
  /// consumed rather than acknowledged, so the same price can be bought again
  /// for another episode.
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
