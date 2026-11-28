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

/// Buys an episode, a pack of the tenant's coins, or a tip to an episode's
/// Authors with the store's payment sheet and hands every transaction the
/// store reports to the server before finishing it.
///
/// The transaction the store reports goes to `ConfirmStorePurchase`, and it
/// is finished only once the server has recorded it — consumed on Google
/// Play, so the same price can be bought again. One the app could not confirm
/// — no session, no network, a store that has not settled — stays with the
/// store, which reports it again on the next launch, and is confirmed again on
/// sign-in and on resume, spaced out further after each failure. One the
/// server refused for good, such as a transaction bought on an intent another
/// reader of this device opened, stays with the store too, for that reader to
/// confirm, and is not sent again while the same reader is signed in.
///
/// A transaction of a subscription is [StoreSubscriber]'s, which listens to
/// the same store, and is left to it.
class StorePurchaser {
  StorePurchaser({
    required this.platform,
    required this.store,
    required this.repository,
    required this.readerId,
    this.isSubscription = _buysNoSubscription,
    this.now = DateTime.now,
  });

  final InAppPurchasePlatform platform;
  final InAppPurchaseStore store;
  final PurchaseRepository repository;

  /// Whether a transaction is of a subscription, which this leaves alone:
  /// [StoreSubscriber.isSubscription] where the app sells plans.
  final Future<bool> Function(PurchaseDetails purchase) isSubscription;

  static Future<bool> _buysNoSubscription(PurchaseDetails _) async => false;

  /// The public ID of the reader who holds the session, empty while nobody
  /// does: whom a transaction is refused for.
  final String Function() readerId;

  /// The clock a retry is spaced out by, which a test replaces.
  final DateTime Function() now;

  /// The wait before a transaction the server could not take is sent again,
  /// doubled after each failure in a row up to [_longestRetryWait]. A resume,
  /// a sign-in, a purchase, and Google Play reporting the transaction again
  /// come within seconds of one another, and every confirmation spends the
  /// reader's allowance for them, so a minute lets them send it once between
  /// them; an hour asks a store or a server that stays down no more than that
  /// often.
  static const _firstRetryWait = Duration(minutes: 1);
  static const _longestRetryWait = Duration(hours: 1);

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

  /// The reader each transaction the server refused for good was refused
  /// for, keyed as [_unconfirmed] is. The server refuses it the same way
  /// every time that reader sends it, so it is sent again only once another
  /// reader is signed in, who may be the one it is for.
  final _refused = <String, String>{};

  /// When each transaction the server could not take yet may be sent again,
  /// and the wait that set it, keyed as [_unconfirmed] is.
  final _retries = <String, ({DateTime at, Duration wait})>{};

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
  ///
  /// A transaction the server could not take is sent again once its wait is
  /// over, or at once when [immediately] is set, for a reader who asked to
  /// check again. One it refused for good is sent again only for another
  /// reader.
  Future<void> reconcile({bool immediately = false}) async {
    for (final purchase in _unconfirmed.values.toList()) {
      await _confirm(purchase, immediately: immediately);
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
  /// is shown as being confirmed. [promotionCode] makes the product the one of
  /// the discounted price, and one that takes the whole price off opens no
  /// sheet: the purchase is already recorded.
  ///
  /// Throws [PurchaseFailure]: [PurchaseFailureKind.storeUnavailable] when the
  /// device cannot pay, [PurchaseFailureKind.notSold] when the store has no
  /// product for the episode, and whatever [PurchaseRepository] throws.
  Future<StorePurchaseOutcome> buy(
    String episodeInternalId, {
    String promotionCode = '',
  }) => _buy(
    () => repository.startStorePurchase(
      episodeInternalId,
      store,
      promotionCode: promotionCode,
    ),
  );

  /// Opens the payment sheet for the pack of the tenant's coins [coinPackId]
  /// names, as [buy] does for an episode. The server grants the coins once it
  /// has recorded the transaction, which is when this answers
  /// [StorePurchaseOutcome.purchased].
  Future<StorePurchaseOutcome> buyCoinPack(String coinPackId) =>
      _buy(() => repository.startCoinPackStorePurchase(coinPackId, store));

  /// Opens the payment sheet for a tip of [amount] to the Authors of the
  /// episode [episodeInternalId] names, as [buy] does for the episode itself.
  /// `StartStoreTip` answers the intent and the product the amount is sold as,
  /// `ConfirmStorePurchase` records the tip, and the transaction is consumed
  /// so the same amount can be given again. A tip opens nothing, so nothing
  /// waits on it but the thanks.
  Future<StorePurchaseOutcome> buyTip(
    String episodeInternalId, {
    required int amount,
  }) => _buy(
    () => repository.startStoreTip(
      episodeInternalId,
      amount: amount,
      store: store,
    ),
  );

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
    if (intent.recorded) {
      return StorePurchaseOutcome.purchased;
    }
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

  Future<void> _confirm(PurchaseDetails purchase, {bool immediately = false}) {
    final transaction = purchase.verificationData.serverVerificationData;
    if (transaction.isEmpty || !_due(transaction, immediately: immediately)) {
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
    final reader = readerId();
    try {
      await repository.confirmStorePurchase(
        store: store,
        transaction: transaction,
        productId: purchase.productID,
      );
    } on PurchaseFailure catch (failure) {
      // The store keeps the transaction, and it is confirmed again later.
      switch (failure.kind) {
        case PurchaseFailureKind.otherAccount ||
            PurchaseFailureKind.transactionRefused:
          _retries.remove(transaction);
          _refused[transaction] = reader;
          _fail(purchase, failure);
        case PurchaseFailureKind.sessionExpired:
          // Signing in sends it again, with no wait left from an earlier
          // failure.
          _retries.remove(transaction);
          _fail(purchase, failure);
        case PurchaseFailureKind.notSettled || PurchaseFailureKind.network:
          _spaceOut(transaction);
          _settle(purchase, StorePurchaseOutcome.pending);
        case _:
          _spaceOut(transaction);
          _fail(purchase, failure);
      }
      return;
    }
    _unconfirmed.remove(transaction);
    _refused.remove(transaction);
    _retries.remove(transaction);
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

  /// Whether [transaction] is to be sent now: not refused for good for the
  /// reader signed in, and past its wait unless [immediately] is set.
  bool _due(String transaction, {required bool immediately}) {
    if (_refused[transaction] == readerId()) {
      return false;
    }
    final retry = _retries[transaction];
    return immediately || retry == null || !now().isBefore(retry.at);
  }

  void _spaceOut(String transaction) {
    final previous = _retries[transaction]?.wait;
    final wait = previous == null
        ? _firstRetryWait
        : previous * 2 < _longestRetryWait
        ? previous * 2
        : _longestRetryWait;
    _retries[transaction] = (at: now().add(wait), wait: wait);
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
  /// for another episode, and the same pack or tip again.
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
