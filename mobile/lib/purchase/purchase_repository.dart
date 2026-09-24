import 'package:flutter/widgets.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/store_purchaser.dart';

/// How a checkout the browser handed back ended, as the `status` of the
/// return URL the API built for the app names it.
enum CheckoutOutcome {
  success('success'),
  cancelled('cancelled');

  const CheckoutOutcome(this.wireName);

  final String wireName;

  /// `null` for a value the API does not send, which is read as no checkout.
  static CheckoutOutcome? fromWire(String? raw) {
    for (final outcome in values) {
      if (outcome.wireName == raw) {
        return outcome;
      }
    }
    return null;
  }
}

/// Which purchase the tenant's app offers for an episode it may sell.
enum AppPurchaseRoute {
  /// The public site's checkout, opened in the system browser.
  externalCheckout,

  /// The App Store's or Google Play's own payment sheet.
  store,
}

/// The store an app buys through with the store's in-app purchase, as
/// `publira.v1.InAppPurchaseStore` names it.
enum InAppPurchaseStore {
  appStore('IN_APP_PURCHASE_STORE_APP_STORE'),
  googlePlay('IN_APP_PURCHASE_STORE_GOOGLE_PLAY');

  const InAppPurchaseStore(this.wireName);

  final String wireName;
}

/// What the store is asked to charge for one episode: the product the
/// episode's price is sold as, and the intent the transaction carries as its
/// account token so the server learns which episode it pays for.
class StorePurchaseIntent {
  const StorePurchaseIntent({required this.intentId, required this.productId});

  final String intentId;
  final String productId;
}

/// Paid-episode purchase, through the public site's checkout or the store's
/// in-app purchase as the tenant's app purchase route says.
abstract class PurchaseRepository {
  /// Whether the tenant can take a payment in this app right now: its web
  /// checkout on the external-checkout route, and the store on this device on
  /// the store route. A tenant that cannot is offered no purchase, whatever
  /// the episode costs.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<bool> acceptsPayments();

  /// Which purchase the tenant's app offers.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<AppPurchaseRoute> appPurchaseRoute();

  /// What the reader in front of the app may do with each published episode
  /// of [seriesPublicId], keyed by episode public id.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<Map<String, EpisodeAccess>> seriesEpisodeAccess(String seriesPublicId);

  /// The series public id [episodePublicId] belongs to, or `null` when the
  /// episode is not public. A checkout return names the episode alone, and
  /// the viewer is addressed by both.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<String?> seriesOfEpisode(String episodePublicId);

  /// The checkout page the signed-in reader pays for [episodePublicId] on,
  /// built to return to the app.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when
  /// there is nothing to pay for.
  Future<Uri> startEpisodeCheckout(String episodePublicId);

  /// Opens a purchase of [episodePublicId] through [store] for the signed-in
  /// reader.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when
  /// there is nothing to pay for, and [PurchaseFailureKind.notSold] when the
  /// tenant does not sell it through [store] right now.
  Future<StorePurchaseIntent> startStorePurchase(
    String episodePublicId,
    InAppPurchaseStore store,
  );

  /// Hands a transaction [store] charged to the server, which verifies it with
  /// the store and records the purchase. [transaction] is the signed
  /// transaction on the App Store and the purchase token on Google Play, and
  /// [productId] the product it was bought as.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.notSettled] for a
  /// transaction the store has not settled, which is confirmed again later.
  Future<void> confirmStorePurchase({
    required InAppPurchaseStore store,
    required String transaction,
    required String productId,
  });

  /// The page of the signed-in reader's purchases [token] names, newest
  /// first, and the first page for an empty one. A guest has bought nothing,
  /// so they are answered [MyPurchasePage.empty] without a request.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<MyPurchasePage> listMyPurchases({String token = ''});
}

/// Looks up the [PurchaseRepository], [CheckoutLauncher], and
/// [StorePurchaser] installed by [PubliraApp].
class PurchaseScope extends InheritedWidget {
  const PurchaseScope({
    super.key,
    this.repository,
    this.launcher,
    this.storePurchaser,
    required super.child,
  });

  final PurchaseRepository? repository;
  final CheckoutLauncher? launcher;

  /// `null` on a device with no store to buy through, which a tenant on the
  /// store route offers no purchase on.
  final StorePurchaser? storePurchaser;

  /// `null` when this run offers no purchase at all, which is what a widget
  /// test that does not care about buying builds.
  static PurchaseScope? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PurchaseScope>();
    if (scope == null || scope.repository == null || scope.launcher == null) {
      return null;
    }
    return scope;
  }

  /// The repository alone, for a screen that lists what was bought and never
  /// opens a checkout. `null` in a build that offers no purchase.
  static PurchaseRepository? repositoryOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PurchaseScope>()?.repository;

  @override
  bool updateShouldNotify(PurchaseScope oldWidget) =>
      repository != oldWidget.repository ||
      launcher != oldWidget.launcher ||
      storePurchaser != oldWidget.storePurchaser;
}
