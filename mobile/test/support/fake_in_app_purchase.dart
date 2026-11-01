import 'dart:async';

import 'package:in_app_purchase_android/billing_client_wrappers.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:in_app_purchase_storekit/store_kit_2_wrappers.dart';

/// An [InAppPurchasePlatform] a widget test drives, standing in for StoreKit:
/// the payment sheet answers with whatever [sheet] reports, and the store's
/// own reports are written with [report].
class FakeInAppPurchasePlatform extends InAppPurchasePlatform {
  FakeInAppPurchasePlatform({
    this.available = true,
    Set<String>? products,
    this.sheet = paysAtOnce,
  }) : products = products ?? {'episode_500'};

  final _purchases = StreamController<List<PurchaseDetails>>.broadcast();

  /// What [isAvailable] answers: false for a device with no store account or
  /// with purchases restricted.
  bool available;

  /// The product IDs the store has.
  Set<String> products;

  /// What the store charges, in yen, for a product that is not named after
  /// its price, such as a pack of coins.
  Map<String, int> prices = {};

  /// The auto-renewable subscriptions the store has, each with the price it
  /// displays and the period it bills, as StoreKit 2 reports them.
  Map<String, ({String price, SK2SubscriptionPeriod period})> subscriptions =
      {};

  /// The subscriptions the store has as Google Play describes them: one
  /// entry per base plan and per offer this reader may take, keyed by product
  /// ID.
  Map<String, List<SubscriptionOfferDetailsWrapper>> playSubscriptions = {};

  /// What the store reports when asked to restore: StoreKit's current
  /// entitlements.
  List<PurchaseDetails> entitlements = [];

  /// How many times the store was asked to restore.
  var restores = 0;

  /// How many times the store was asked for its products.
  var productQueries = 0;

  /// How many of the next product queries fail, answered as Google Play
  /// answers one: no products, and the error beside them.
  var failingProductQueries = 0;

  /// What the payment sheet reports once it is opened for a purchase.
  List<PurchaseDetails> Function(PurchaseParam param) sheet;

  /// Every purchase the payment sheet was opened for, in order.
  final bought = <PurchaseParam>[];

  /// Every transaction the app finished, in order.
  final finished = <PurchaseDetails>[];

  /// The reader paid without being asked anything else.
  static List<PurchaseDetails> paysAtOnce(PurchaseParam param) => [
    storeTransaction(
      id: '2000000000000001',
      productId: param.productDetails.id,
      intentId: param.applicationUserName!,
    ),
  ];

  /// A transaction as StoreKit 2 reports it, its account token the intent it
  /// was bought for.
  static SK2PurchaseDetails storeTransaction({
    required String id,
    required String productId,
    required String intentId,
    PurchaseStatus status = PurchaseStatus.purchased,
  }) => SK2PurchaseDetails(
    productID: productId,
    purchaseID: id,
    verificationData: PurchaseVerificationData(
      localVerificationData: '',
      serverVerificationData: 'jws-$id',
      source: 'app_store',
    ),
    transactionDate: '0',
    status: status,
    // StoreKit writes the UUID it was handed in capitals.
    appAccountToken: intentId.toUpperCase(),
  );

  /// A transaction of an auto-renewable subscription as StoreKit 2 reports
  /// it, which carries the date the subscription renews or expires.
  static SK2PurchaseDetails subscriptionTransaction({
    required String id,
    required String productId,
    required String intentId,
    PurchaseStatus status = PurchaseStatus.purchased,
  }) {
    final token = intentId.toUpperCase();
    return SK2PurchaseDetails(
      productID: productId,
      purchaseID: id,
      verificationData: PurchaseVerificationData(
        localVerificationData: '',
        serverVerificationData: 'jws-$id',
        source: 'app_store',
      ),
      transactionDate: '0',
      status: status,
      appAccountToken: token,
      expirationDate: '4102444800000',
      sk2Transaction: SK2Transaction(
        id: id,
        originalId: id,
        productId: productId,
        purchaseDate: '0',
        expirationDate: '4102444800000',
        appAccountToken: token,
        subscriptionGroupID: 'group',
      ),
    );
  }

  /// An order StoreKit reports without a transaction: a pending Ask to Buy,
  /// or a sheet the reader closed.
  static SK2PurchaseDetails orderWithoutTransaction(
    String productId,
    PurchaseStatus status,
  ) => SK2PurchaseDetails(
    productID: productId,
    purchaseID: null,
    verificationData: PurchaseVerificationData(
      localVerificationData: '',
      serverVerificationData: '',
      source: 'app_store',
    ),
    transactionDate: null,
    status: status,
  );

  /// The store reports [purchases] on its own, as it does on launch for what
  /// an earlier run left unfinished.
  void report(List<PurchaseDetails> purchases) => _purchases.add(purchases);

  Future<void> close() => _purchases.close();

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _purchases.stream;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<ProductDetailsResponse> queryProductDetails(
    Set<String> identifiers,
  ) async {
    productQueries++;
    if (failingProductQueries > 0) {
      failingProductQueries--;
      return ProductDetailsResponse(
        productDetails: const [],
        notFoundIDs: identifiers.toList(),
        error: IAPError(
          source: 'google_play',
          code: 'service_unavailable',
          message: '',
        ),
      );
    }
    return ProductDetailsResponse(
      productDetails: [
        for (final id in identifiers)
          if (playSubscriptions[id] case final offers?)
            ...GooglePlayProductDetails.fromProductDetails(
              ProductDetailsWrapper(
                description: '',
                name: id,
                productId: id,
                productType: ProductType.subs,
                subscriptionOfferDetails: offers,
                title: id,
              ),
            ),
        for (final id in identifiers)
          if (subscriptions[id] case final subscription?)
            AppStoreProduct2Details.fromSK2Product(
              SK2Product(
                id: id,
                displayName: id,
                displayPrice: subscription.price,
                description: '',
                price: 0,
                type: SK2ProductType.autoRenewable,
                priceLocale: SK2PriceLocale(
                  currencyCode: 'JPY',
                  currencySymbol: '¥',
                ),
                subscription: SK2SubscriptionInfo(
                  subscriptionGroupID: 'group',
                  promotionalOffers: const [],
                  subscriptionPeriod: subscription.period,
                ),
              ),
            ),
        for (final id in identifiers.where(products.contains))
          ProductDetails(
            id: id,
            title: id,
            description: '',
            price: '¥${_priceOf(id)}',
            rawPrice: _priceOf(id).toDouble(),
            currencyCode: 'JPY',
          ),
      ],
      notFoundIDs: identifiers
          .where(
            (id) =>
                !products.contains(id) &&
                !subscriptions.containsKey(id) &&
                !playSubscriptions.containsKey(id),
          )
          .toList(),
    );
  }

  /// An episode's product is named after its price, as `episode_500` is ¥500.
  int _priceOf(String id) => id.startsWith('episode_')
      ? int.parse(id.split('_').last)
      : prices[id] ?? 0;

  @override
  Future<bool> buyConsumable({
    required PurchaseParam purchaseParam,
    bool autoConsume = true,
  }) async {
    bought.add(purchaseParam);
    final reported = sheet(purchaseParam);
    // The sheet answers after the call that opened it has returned.
    scheduleMicrotask(() => report(reported));
    return true;
  }

  @override
  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam}) async {
    bought.add(purchaseParam);
    final reported = subscriptionSheet(purchaseParam);
    scheduleMicrotask(() => report(reported));
    return true;
  }

  /// What the payment sheet reports once it is opened for a subscription.
  List<PurchaseDetails> Function(PurchaseParam param) subscriptionSheet =
      subscribesAtOnce;

  /// The reader subscribed without being asked anything else.
  static List<PurchaseDetails> subscribesAtOnce(PurchaseParam param) => [
    subscriptionTransaction(
      id: '3000000000000001',
      productId: param.productDetails.id,
      intentId: param.applicationUserName!,
    ),
  ];

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async {
    finished.add(purchase);
  }

  @override
  Future<void> restorePurchases({String? applicationUserName}) async {
    restores++;
    if (entitlements.isNotEmpty) {
      report(entitlements);
    }
  }
}
