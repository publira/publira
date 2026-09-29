import 'dart:async';

import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';

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
  ) async => ProductDetailsResponse(
    productDetails: [
      for (final id in identifiers.where(products.contains))
        ProductDetails(
          id: id,
          title: id,
          description: '',
          price: '¥500',
          rawPrice: 500,
          currencyCode: 'JPY',
        ),
    ],
    notFoundIDs: identifiers.where((id) => !products.contains(id)).toList(),
  );

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
  Future<void> completePurchase(PurchaseDetails purchase) async {
    finished.add(purchase);
  }

  @override
  Future<void> restorePurchases({String? applicationUserName}) async {}
}
