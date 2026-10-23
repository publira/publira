/// @docImport 'package:publira/app.dart';
/// @docImport 'package:publira/purchase/purchase_failure.dart';
library;

import 'package:flutter/widgets.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/store_purchaser.dart';

/// How many rows one page of the reader's purchases holds unless a read asks
/// for another number, which is also the API's own fallback for a request
/// naming no limit.
const myPurchasePageLimit = 20;

/// The most rows `ListMyPurchases` answers in one page.
const myPurchasePageLimitMax = 100;

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

/// How long a screen waits before each re-read of what the browser reported
/// paid for and the API does not report bought yet. The webhook that records
/// the purchase races the browser's return, so the first read after it can be
/// too early.
const checkoutConfirmationDelays = [Duration(seconds: 2), Duration(seconds: 4)];

/// Which purchase the tenant's app offers for an episode it may sell.
enum AppPurchaseRoute {
  /// The public site's checkout, opened in the system browser.
  externalCheckout,

  /// The App Store's or Google Play's own payment sheet.
  store,
}

/// The store an app buys through with the store's in-app purchase, as
/// `publira.v1.InAppPurchaseStore` names it.
enum InAppPurchaseStore { appStore, googlePlay }

/// What the store is asked to charge for one episode: the product the
/// episode's price is sold as, and the intent the transaction carries as its
/// account token so the server learns which episode it pays for.
class StorePurchaseIntent {
  const StorePurchaseIntent({required this.intentId, required this.productId});

  final String intentId;
  final String productId;
}

/// What the rest of a series would cost the reader in one checkout, as
/// `publira.v1.SeriesRemainderOffer` quotes it. Every amount is in the minor
/// unit of the tenant currency.
class SeriesRemainderOffer {
  const SeriesRemainderOffer({
    required this.episodeCount,
    required this.listPrice,
    required this.discountPercent,
    required this.price,
  });

  /// How many episodes the checkout would sell, never 0.
  final int episodeCount;

  /// What those episodes cost bought one by one.
  final int listPrice;

  /// What the series takes off [listPrice], in whole percent; 0 for nothing.
  final int discountPercent;

  /// What the reader pays.
  final int price;
}

/// What the reader in front of the app holds of one series, as
/// `GetSeriesEpisodeAccess` answers it.
class SeriesPurchaseState {
  const SeriesPurchaseState({
    this.access = const {},
    this.ownedEpisodeIds = const {},
    this.remainder,
  });

  /// A series the reader holds nothing of and is offered nothing in, which is
  /// what a screen shows until the API has answered.
  static const none = SeriesPurchaseState();

  /// What the reader may do with each published episode, keyed by episode
  /// public id.
  final Map<String, EpisodeAccess> access;

  /// Internal ids of the episodes the reader owns for good: bought one by one,
  /// in a volume, or with the rest of the series. A rental or a ticket opens
  /// an episode without owning it.
  final Set<String> ownedEpisodeIds;

  /// The rest of the series as one checkout would sell it to the reader now,
  /// or `null` when it would sell nothing.
  final SeriesRemainderOffer? remainder;

  /// Whether every episode of [volume] is already the reader's for good, so
  /// buying it would add nothing.
  bool owns(VolumeItem volume) =>
      volume.episodeIds.isNotEmpty &&
      volume.episodeIds.every(ownedEpisodeIds.contains);
}

/// Paid-episode purchase, through the public site's checkout or the store's
/// in-app purchase as the tenant's app purchase route says.
abstract class PurchaseRepository {
  /// Whether the tenant can take a payment in this app right now: its web
  /// checkout on the external-checkout route (`accepts_payments`), and the
  /// store on this device on the store route (`accepts_app_store_payments` on
  /// iOS, `accepts_google_play_payments` on Android). A tenant that cannot is
  /// offered no purchase, whatever the episode costs.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<bool> acceptsPayments();

  /// Which purchase the tenant's app offers, as the `app_purchase_route`
  /// `GetTenant` answers with names it.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<AppPurchaseRoute> appPurchaseRoute();

  /// The ISO 4217 code of the currency the tenant sells in, which every price
  /// the app shows is an integer in the minor unit of.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error, and
  /// for an answer that names no currency.
  Future<String> currency();

  /// What the reader in front of the app may do with each published episode
  /// of the series [seriesInternalId] names, which of them they own, and what
  /// the rest of it would cost them. A guest is answered as a reader who
  /// holds nothing.
  ///
  /// A row of the series screen offers a purchase only where this answers the
  /// episode locked for the reader, so an episode they bought, hold a ticket
  /// for, or can read inside a free window is offered nothing.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<SeriesPurchaseState> seriesEpisodeAccess(String seriesInternalId);

  /// The series public id [episodePublicId] belongs to, or `null` when the
  /// episode is not public. A checkout return names the episode alone, and
  /// the viewer is addressed by both.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<String?> seriesOfEpisode(String episodePublicId);

  /// The checkout page the signed-in reader pays for the [kind] of the
  /// episode [episodeInternalId] names on, which `StartEpisodeCheckout` with
  /// `client: CLIENT_MOBILE` builds to return to the app. The page names the
  /// episode in its translation in [locale], the reader's.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when
  /// there is nothing to pay for, and [PurchaseFailureKind.notSold] for a
  /// rental of an episode that is not rented.
  Future<Uri> startEpisodeCheckout(
    String episodeInternalId, {
    required String locale,
    PurchaseKind kind = PurchaseKind.purchase,
  });

  /// The checkout page the signed-in reader pays for the volume
  /// [volumeInternalId] names on, built to return to the app on its series.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when the
  /// reader already holds the volume, [PurchaseFailureKind.gone] when it is no
  /// longer sold in the app, and [PurchaseFailureKind.notSold] when the app
  /// sells through the store, which has no product for a volume.
  Future<Uri> startVolumeCheckout(String volumeInternalId);

  /// The checkout page the signed-in reader pays for every episode of the
  /// series [seriesInternalId] they do not own yet on, built to return to the
  /// app on the series. The page names the episodes in their translation in
  /// [locale], the reader's.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when the
  /// reader already owns every one of them, and [PurchaseFailureKind.notSold]
  /// when there is nothing one checkout could sell, or the app sells through
  /// the store.
  Future<Uri> startSeriesRemainderCheckout(
    String seriesInternalId, {
    required String locale,
  });

  /// Opens a purchase of the episode [episodeInternalId] names through [store]
  /// for the signed-in reader.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when
  /// there is nothing to pay for, and [PurchaseFailureKind.notSold] when the
  /// tenant does not sell it through [store] right now.
  Future<StorePurchaseIntent> startStorePurchase(
    String episodeInternalId,
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
  /// first, and the first page for an empty one, holding at most [limit]
  /// rows. A guest has bought nothing, so they are answered
  /// [MyPurchasePage.empty] without a request. Each title is the one written
  /// in [locale], the reader's, as the catalog reads it.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<MyPurchasePage> listMyPurchases({
    required String locale,
    String token = '',
    int limit = myPurchasePageLimit,
  });
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
