/// @docImport 'package:publira/purchase/store_purchaser.dart';
library;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:in_app_purchase_android/billing_client_wrappers.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:in_app_purchase_storekit/store_kit_2_wrappers.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// How a subscription through the store's payment sheet ended.
enum StoreSubscriptionOutcome {
  /// The server has recorded the subscription.
  subscribed,

  /// The store took the order but has not settled it, or the server could not
  /// confirm it yet; it is confirmed once it can be.
  pending,

  /// The reader closed the payment sheet without subscribing.
  cancelled,
}

/// What asking the store for the subscriptions it holds found.
enum StoreRestoreOutcome {
  /// A subscription the store holds is the reader's, and the server has it as
  /// the store reports it now.
  restored,

  /// The store holds a subscription the server has recorded for another
  /// account, which keeps it.
  otherAccount,

  /// The store holds no subscription of the tenant's app.
  none,
}

/// The unit a store bills a subscription by.
enum StoreBillingUnit { day, week, month, year }

/// How often a store bills a subscription: every [count] [unit]s.
class StoreBillingPeriod {
  const StoreBillingPeriod(this.unit, this.count);

  final StoreBillingUnit unit;
  final int count;

  @override
  bool operator ==(Object other) =>
      other is StoreBillingPeriod && other.unit == unit && other.count == count;

  @override
  int get hashCode => Object.hash(unit, count);
}

/// A plan as the device's store sells it: the price the store charges in the
/// reader's storefront, formatted by the store, and the period it bills, or
/// `null` where the store did not say.
class StorePlanOffer {
  const StorePlanOffer({
    required this.plan,
    required this.price,
    required this.period,
  });

  final SubscriptionPlan plan;
  final String price;
  final StoreBillingPeriod? period;
}

/// Where the reader changes or cancels a subscription [store] bills: the
/// store's own page of their subscriptions, on Google Play opened on the
/// subscription [productId] names in the app [applicationId] names.
Uri storeSubscriptionsUrl(
  InAppPurchaseStore store, {
  String productId = '',
  String applicationId = '',
}) => switch (store) {
  InAppPurchaseStore.appStore => Uri.https(
    'apps.apple.com',
    '/account/subscriptions',
  ),
  InAppPurchaseStore.googlePlay => Uri.https(
    'play.google.com',
    '/store/account/subscriptions',
    productId.isEmpty || applicationId.isEmpty
        ? null
        : {'sku': productId, 'package': applicationId},
  ),
};

/// Subscribes the reader to a plan with the store's payment sheet, and hands
/// every transaction of a subscription the store reports to the server before
/// finishing it.
///
/// It listens to the same store as [StorePurchaser], which hands the server
/// what an episode or a pack of coins was bought for, and each leaves to the
/// other what [isSubscription] does not answer as its own. A transaction goes
/// to `ConfirmStoreSubscription`, and it is finished only once the server has
/// recorded it — acknowledged on Google Play, never consumed. One the app
/// could not confirm stays with the store and is confirmed again on sign-in
/// and on resume, as a purchase is.
class StoreSubscriber {
  StoreSubscriber({
    required this.platform,
    required this.store,
    required this.repository,
    required this.applicationId,
  });

  final InAppPurchasePlatform platform;
  final InAppPurchaseStore store;
  final PurchaseRepository repository;

  /// The app's own ID in its store, which Google Play's page of subscriptions
  /// is opened for.
  final Future<String> Function() applicationId;

  StreamSubscription<List<PurchaseDetails>>? _subscription;

  final _recorded = StreamController<String>.broadcast();

  /// The product ID of each subscription as the server records it, whenever
  /// that is: one held pending is recorded on a later resume or sign-in, long
  /// after the sheet that sold it was closed. A screen showing what a plan
  /// opens reads it again on hearing of one.
  Stream<String> get recorded => _recorded.stream;

  /// Whether each product the store has answered for is a subscription,
  /// keyed by product ID.
  final _kinds = <String, bool>{};

  /// Transactions the server has not recorded yet, keyed by what is sent to
  /// it, and the confirmation of each one under way, so a transaction
  /// reported twice is confirmed once.
  final _unconfirmed = <String, PurchaseDetails>{};
  final _confirming = <String, Future<void>>{};

  _OpenSubscription? _open;
  var _subscribing = false;

  /// What each confirmation found while the reader is restoring, and `null`
  /// otherwise.
  _Restore? _restore;

  /// Starts listening to what the store reports. On iOS that is where renewals
  /// and the transactions an earlier run left unfinished arrive; Google Play
  /// reports them only when asked, so they are asked for here.
  Future<void> start() async {
    _subscription ??= platform.purchaseStream.listen(
      _onPurchases,
      onError: (Object _) {},
    );
    await _askForUnfinished();
  }

  /// Confirms again every transaction the server has not recorded, and
  /// returns once none is being confirmed any more.
  Future<void> reconcile() async {
    for (final purchase in _unconfirmed.values.toList()) {
      await _confirm(purchase);
    }
    await _askForUnfinished();
    await _settled();
  }

  /// Asks the store for every subscription it holds for this device's store
  /// account — StoreKit's current entitlements, Google Play's purchases — and
  /// confirms each one, recorded already or not, so the server takes in
  /// whatever the store has changed since.
  ///
  /// Throws [PurchaseFailure]: [PurchaseFailureKind.storeUnavailable] when the
  /// device cannot reach the store, and the failure of a subscription found
  /// that the server could not confirm, such as
  /// [PurchaseFailureKind.network].
  Future<StoreRestoreOutcome> restore() async {
    if (!await _isAvailable()) {
      throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
    }
    final restore = _restore = _Restore();
    try {
      for (final purchase in _unconfirmed.values.toList()) {
        await _confirm(purchase);
      }
      try {
        await platform.restorePurchases();
      } on Object catch (error) {
        throw PurchaseFailure(
          PurchaseFailureKind.storeUnavailable,
          message: '$error',
        );
      }
      await _settled();
    } finally {
      if (identical(_restore, restore)) {
        _restore = null;
      }
    }
    if (restore.restored) {
      return StoreRestoreOutcome.restored;
    }
    if (restore.otherAccount) {
      return StoreRestoreOutcome.otherAccount;
    }
    final failure = restore.failure;
    if (failure != null) {
      throw failure;
    }
    return StoreRestoreOutcome.none;
  }

  /// The page of the store's subscriptions for one [store] bills, opened on
  /// [productId] where the store can be.
  Future<Uri> manageUrl(InAppPurchaseStore store, String productId) async {
    if (store != InAppPurchaseStore.googlePlay || productId.isEmpty) {
      return storeSubscriptionsUrl(store);
    }
    String id;
    try {
      id = await applicationId();
    } on Object {
      id = '';
    }
    return storeSubscriptionsUrl(
      store,
      productId: productId,
      applicationId: id,
    );
  }

  Future<void> dispose() async {
    await _subscription?.cancel();
    _subscription = null;
    await _recorded.close();
  }

  /// Whether [purchase] is a transaction of a subscription, which is the
  /// server's `ConfirmStoreSubscription` to take rather than
  /// `ConfirmStorePurchase`.
  ///
  /// A StoreKit 2 transaction says so itself, by the expiry only a
  /// subscription has. Google Play's does not, so the store is asked what the
  /// product is. Its answer is kept for the product, and a query that answers
  /// nothing for it is asked again next time: Google Play reports a failure
  /// as an empty answer, which says nothing about what the product is. Until
  /// then the transaction is not taken as a subscription.
  Future<bool> isSubscription(PurchaseDetails purchase) async {
    if (purchase case SK2PurchaseDetails(
      sk2Transaction: _?,
      :final expirationDate,
    )) {
      return expirationDate != null;
    }
    final productId = purchase.productID;
    if (productId.isEmpty) {
      return false;
    }
    if (_kinds[productId] case final known?) {
      return known;
    }
    final ProductDetailsResponse response;
    try {
      response = await platform.queryProductDetails({productId});
    } on PlatformException {
      return false;
    }
    for (final product in response.productDetails) {
      if (product.id == productId) {
        return _kinds[productId] = _sellsSubscription(product);
      }
    }
    return false;
  }

  static bool _sellsSubscription(ProductDetails product) => switch (product) {
    AppStoreProduct2Details(:final sk2Product) =>
      sk2Product.type == SK2ProductType.autoRenewable,
    GooglePlayProductDetails(:final productDetails) =>
      productDetails.productType == ProductType.subs,
    _ => false,
  };

  /// What the store sells each of [plans] at, for the plans whose product the
  /// store has, in the order of [plans]. A device that cannot pay is offered
  /// none.
  Future<List<StorePlanOffer>> offers(List<SubscriptionPlan> plans) async {
    final productIds = {
      for (final plan in plans)
        if (plan.productIdIn(store) case final id when id.isNotEmpty) id,
    };
    if (productIds.isEmpty || !await _isAvailable()) {
      return const [];
    }
    final ProductDetailsResponse response;
    try {
      response = await platform.queryProductDetails(productIds);
    } on PlatformException {
      return const [];
    }
    final offers = <StorePlanOffer>[];
    for (final plan in plans) {
      final product = _planEntry(
        response.productDetails,
        plan.productIdIn(store),
      );
      if (product == null) {
        continue;
      }
      _kinds[product.id] = true;
      offers.add(
        StorePlanOffer(
          plan: plan,
          price: _recurringPhase(product)?.formattedPrice ?? product.price,
          period: _periodOf(product),
        ),
      );
    }
    return List.unmodifiable(offers);
  }

  /// Opens the payment sheet for the plan [planId] names.
  ///
  /// `StartStoreSubscription` answers with an intent and the subscription the
  /// plan is sold as, and the sheet is opened for that product with the intent
  /// as `appAccountToken` (iOS, StoreKit 2) or `obfuscatedAccountId`
  /// (Android). A subscription the store holds for approval is answered as
  /// pending.
  ///
  /// Throws [PurchaseFailure]: [PurchaseFailureKind.storeUnavailable] when the
  /// device cannot pay, [PurchaseFailureKind.notSold] when the store has no
  /// product for the plan, and whatever [PurchaseRepository] throws.
  Future<StoreSubscriptionOutcome> subscribe(String planId) async {
    if (_subscribing) {
      throw const PurchaseFailure(
        PurchaseFailureKind.unexpected,
        message: 'a subscription is already open',
      );
    }
    _subscribing = true;
    try {
      return await _subscribeOnce(planId);
    } finally {
      _subscribing = false;
    }
  }

  Future<StoreSubscriptionOutcome> _subscribeOnce(String planId) async {
    if (!await _isAvailable()) {
      throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
    }
    // A subscription the server could not take before is taken now, which may
    // be the plan the reader is about to subscribe to again.
    await reconcile();
    final intent = await repository.startStoreSubscription(planId, store);
    final product = await _product(intent.productId);
    final open = _OpenSubscription(intent);
    _open = open;
    try {
      final launched = await platform.buyNonConsumable(
        purchaseParam: PurchaseParam(
          productDetails: product,
          // `appAccountToken` on iOS, `obfuscatedAccountId` on Android.
          applicationUserName: intent.intentId,
        ),
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

  /// Returns once what the store reported has been confirmed. What Google Play
  /// and StoreKit report arrives on the stream after the call that asked for
  /// it has returned.
  Future<void> _settled() async {
    await Future<void>.delayed(Duration.zero);
    await Future.wait(_confirming.values.toList());
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
    final product = _planEntry(response.productDetails, productId);
    if (product == null) {
      throw PurchaseFailure(
        PurchaseFailureKind.notSold,
        message: 'the store has no product $productId',
      );
    }
    _kinds[productId] = true;
    return product;
  }

  /// The entry of [products] the plan [productId] names is sold as.
  ///
  /// Google Play answers one entry per base plan of a subscription and one per
  /// offer on it, and lists only the offers this reader may take. A plan is
  /// billed by its base plan, and an offer the tenant set up on it, such as a
  /// free trial, has to be named in the purchase for Play to apply it, so the
  /// offer whose first phase costs the reader least is taken where there is
  /// one. StoreKit applies an introductory offer by itself and answers one
  /// entry per product.
  static ProductDetails? _planEntry(
    List<ProductDetails> products,
    String productId,
  ) {
    final entries = [
      for (final product in products)
        if (product.id == productId) product,
    ];
    final basePlan =
        entries
            .where((entry) => _offerOf(entry)?.offerId == null)
            .firstOrNull ??
        entries.firstOrNull;
    final base = basePlan == null ? null : _offerOf(basePlan);
    if (base == null) {
      return basePlan;
    }
    ProductDetails chosen = basePlan!;
    var cheapest = _firstPhaseMicros(base);
    for (final entry in entries) {
      final offer = _offerOf(entry);
      if (offer == null ||
          offer.offerId == null ||
          offer.basePlanId != base.basePlanId) {
        continue;
      }
      final micros = _firstPhaseMicros(offer);
      if (micros < cheapest) {
        chosen = entry;
        cheapest = micros;
      }
    }
    return chosen;
  }

  /// The base plan or the offer a Google Play entry stands for, or `null` for
  /// an entry of another store.
  static SubscriptionOfferDetailsWrapper? _offerOf(ProductDetails product) {
    if (product case GooglePlayProductDetails(
      :final productDetails,
      :final subscriptionIndex?,
    )) {
      return productDetails.subscriptionOfferDetails?[subscriptionIndex];
    }
    return null;
  }

  static int _firstPhaseMicros(SubscriptionOfferDetailsWrapper offer) =>
      offer.pricingPhases.firstOrNull?.priceAmountMicros ?? 0;

  /// The phase of a Google Play base plan or offer that repeats, which is
  /// the last: the price and the period the plan bills once a trial or an
  /// introductory price has run out.
  static PricingPhaseWrapper? _recurringPhase(ProductDetails product) =>
      _offerOf(product)?.pricingPhases.lastOrNull;

  static StoreBillingPeriod? _periodOf(ProductDetails product) {
    if (product case AppStoreProduct2Details(:final sk2Product)) {
      final period = sk2Product.subscription?.subscriptionPeriod;
      if (period == null || period.value < 1) {
        return null;
      }
      return StoreBillingPeriod(switch (period.unit) {
        SK2SubscriptionPeriodUnit.day => StoreBillingUnit.day,
        SK2SubscriptionPeriodUnit.week => StoreBillingUnit.week,
        SK2SubscriptionPeriodUnit.month => StoreBillingUnit.month,
        SK2SubscriptionPeriodUnit.year => StoreBillingUnit.year,
      }, period.value);
    }
    final billingPeriod = _recurringPhase(product)?.billingPeriod;
    return billingPeriod == null ? null : parseBillingPeriod(billingPeriod);
  }

  void _onPurchases(List<PurchaseDetails> purchases) {
    for (final purchase in purchases) {
      switch (purchase.status) {
        case PurchaseStatus.pending:
          _settle(purchase, StoreSubscriptionOutcome.pending);
        case PurchaseStatus.canceled:
          _settle(purchase, StoreSubscriptionOutcome.cancelled);
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
    if (!await isSubscription(purchase)) {
      return;
    }
    // A subscription the store holds as finished is one the server recorded
    // already, and the server follows it through the store's notifications
    // from then on. Google Play reports it on every resume, so it is confirmed
    // again only when the reader asks to restore.
    if (!purchase.pendingCompletePurchase &&
        _restore == null &&
        !_unconfirmed.containsKey(transaction)) {
      return;
    }
    _unconfirmed[transaction] = purchase;
    try {
      await repository.confirmStoreSubscription(
        store: store,
        transaction: transaction,
        productId: purchase.productID,
      );
    } on PurchaseFailure catch (failure) {
      switch (failure.kind) {
        case PurchaseFailureKind.otherAccount:
          // The server has it, for its own account, and keeps it there.
          _unconfirmed.remove(transaction);
          _restore?.otherAccount = true;
          await _finishQuietly(purchase);
          _fail(purchase, failure);
        case PurchaseFailureKind.notSettled || PurchaseFailureKind.network:
          // The store keeps the transaction, and it is confirmed again later.
          _restore?.failure ??= failure;
          _settle(purchase, StoreSubscriptionOutcome.pending);
        case _:
          _restore?.failure ??= failure;
          _fail(purchase, failure);
      }
      return;
    }
    _unconfirmed.remove(transaction);
    _restore?.restored = true;
    if (!_recorded.isClosed) {
      _recorded.add(purchase.productID);
    }
    await _finishQuietly(purchase);
    _settle(purchase, StoreSubscriptionOutcome.subscribed);
  }

  /// Finishes a transaction the server has recorded: acknowledged on Google
  /// Play, which a subscription is never consumed by, and finished on the App
  /// Store. One the store reports finished already is left as it is.
  Future<void> _finishQuietly(PurchaseDetails purchase) async {
    if (!purchase.pendingCompletePurchase) {
      return;
    }
    try {
      await platform.completePurchase(purchase);
    } on Object {
      // The server has the subscription. The store reports the transaction
      // again, the server answers it with the same subscription, and it is
      // finished then.
    }
  }

  /// The open subscription [purchase] answers, matched as [StorePurchaser]
  /// matches an open purchase: by the intent the transaction carries, else by
  /// its product, and a report that names no product answers whichever order
  /// is open.
  _OpenSubscription? _openFor(PurchaseDetails purchase) {
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

  void _settle(PurchaseDetails purchase, StoreSubscriptionOutcome outcome) {
    _openFor(purchase)?.outcome.complete(outcome);
  }

  void _fail(PurchaseDetails purchase, PurchaseFailure failure) {
    _openFor(purchase)?.outcome.completeError(failure);
  }
}

/// The period an ISO 8601 duration of Google Play's billing names, such as
/// `P1M`, or `null` for one that is not a whole number of a single unit.
StoreBillingPeriod? parseBillingPeriod(String value) {
  final match = RegExp(r'^P(\d+)([DWMY])$').firstMatch(value.trim());
  if (match == null) {
    return null;
  }
  final count = int.parse(match.group(1)!);
  if (count < 1) {
    return null;
  }
  return StoreBillingPeriod(switch (match.group(2)) {
    'D' => StoreBillingUnit.day,
    'W' => StoreBillingUnit.week,
    'M' => StoreBillingUnit.month,
    _ => StoreBillingUnit.year,
  }, count);
}

class _OpenSubscription {
  _OpenSubscription(this.intent);

  final StorePurchaseIntent intent;
  final outcome = Completer<StoreSubscriptionOutcome>();
}

class _Restore {
  var restored = false;
  var otherAccount = false;
  PurchaseFailure? failure;
}
