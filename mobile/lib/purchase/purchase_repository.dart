/// @docImport 'package:publira/app.dart';
/// @docImport 'package:publira/purchase/purchase_failure.dart';
library;

import 'package:flutter/widgets.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/purchase/store_subscriber.dart';

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

/// What the store is asked to charge for one episode or one pack of coins: the
/// product the episode's price or the pack is sold as, and the intent the
/// transaction carries as its account token so the server learns what it pays
/// for.
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

/// What a subscription plan opens, as `publira.types.v1.SubscriptionPlanScope`
/// names it.
enum SubscriptionPlanScope {
  /// Every episode of the tenant.
  all,

  /// Every episode of the series filed under the plan's labels.
  label,

  /// Every episode of the plan's series.
  series,
}

/// A plan the tenant sells, as `ListSubscriptionPlans` answers it: what
/// decides whether it opens a work, and what the app's own list of plans says
/// about it.
class SubscriptionPlan {
  const SubscriptionPlan({
    required this.scope,
    this.id = '',
    this.name = '',
    this.description = '',
    this.labelIds = const {},
    this.seriesIds = const {},
    this.labelNames = const [],
    this.seriesTitles = const [],
    this.appStoreProductId = '',
    this.googlePlayProductId = '',
  });

  /// The plan's internal id, which `StartStoreSubscription` addresses it by.
  final String id;
  final String name;

  /// Plain text; empty when the tenant wrote none.
  final String description;

  final SubscriptionPlanScope scope;

  /// Public ids of the labels a [SubscriptionPlanScope.label] plan opens the
  /// series of, among those the app may show.
  final Set<String> labelIds;

  /// Public ids of the series a [SubscriptionPlanScope.series] plan opens,
  /// among those the app may show.
  final Set<String> seriesIds;

  /// The names of the labels and the titles of the series the plan opens,
  /// among those the app may show, in the order the plan names them.
  final List<String> labelNames;
  final List<String> seriesTitles;

  /// The auto-renewable subscription the plan is sold as in the App Store and
  /// in Google Play; empty where the app does not sell it there.
  final String appStoreProductId;
  final String googlePlayProductId;

  /// The product the plan is sold as in [store], or an empty string where it
  /// is not.
  String productIdIn(InAppPurchaseStore store) => switch (store) {
    InAppPurchaseStore.appStore => appStoreProductId,
    InAppPurchaseStore.googlePlay => googlePlayProductId,
  };

  /// Whether the plan opens the series [seriesId] names, which is filed under
  /// the label [labelId] names. An empty [labelId] is a series under no label,
  /// or one whose label is not known, which a plan of labels does not open.
  bool opens({required String seriesId, String labelId = ''}) {
    return switch (scope) {
      SubscriptionPlanScope.all => true,
      SubscriptionPlanScope.label =>
        labelId.isNotEmpty && labelIds.contains(labelId),
      SubscriptionPlanScope.series => seriesIds.contains(seriesId),
    };
  }
}

/// Where a reader's subscription stands, as
/// `publira.types.v1.SubscriptionStatus` names it.
enum SubscriptionStatus {
  /// The first payment has not gone through yet.
  incomplete,

  /// The first payment never went through, so the subscription never began.
  incompleteExpired,
  trialing,
  active,

  /// The latest payment did not go through, and the plan still opens what it
  /// covers while it is retried.
  pastDue,
  canceled,

  /// The payments stopped going through, and the plan opens nothing until one
  /// does.
  unpaid,
  paused,

  /// A status this build has no name for, read as over.
  unknown;

  /// Whether the plan still opens what it covers, or will again once a
  /// payment goes through: what a reader holds, as opposed to a plan that is
  /// over.
  bool get held => switch (this) {
    trialing || active || pastDue || unpaid || paused => true,
    incomplete || incompleteExpired || canceled || unknown => false,
  };
}

/// The signed-in reader's subscription, as `GetMySubscription` answers it:
/// the latest one that is not over, or failing that the latest one that is.
class MySubscription {
  const MySubscription({
    required this.planName,
    required this.status,
    this.currentPeriodEnd,
    this.cancelAtPeriodEnd = false,
    this.store,
    this.productId = '',
  });

  final String planName;
  final SubscriptionStatus status;

  /// The end of the period paid for, or of the grace period a store gives a
  /// past due subscription; `null` when the API reported none.
  final DateTime? currentPeriodEnd;

  /// Whether the reader has canceled it, which ends it at [currentPeriodEnd]
  /// rather than renewing it.
  final bool cancelAtPeriodEnd;

  /// The store the reader subscribed through in the app, which is where they
  /// change or cancel it, or `null` for a subscription the tenant's web
  /// checkout bills, which the billing portal manages.
  final InAppPurchaseStore? store;

  /// The product the plan is sold as in [store], which Google Play's page of
  /// subscriptions is opened on; empty for a subscription no store bills.
  final String productId;
}

/// What the reader in front of the app holds of one series, as
/// `GetSeriesEpisodeAccess` answers it.
class SeriesPurchaseState {
  const SeriesPurchaseState({
    this.access = const {},
    this.entitlementSources = const {},
    this.ownedEpisodeIds = const {},
    this.remainder,
  });

  /// A series the reader holds nothing of and is offered nothing in, which is
  /// what a screen shows until the API has answered.
  static const none = SeriesPurchaseState();

  /// What the reader may do with each published episode, keyed by episode
  /// public id.
  final Map<String, EpisodeAccess> access;

  /// Why the reader may open each episode [access] answers as
  /// [EpisodeAccess.entitled], keyed by episode public id. An episode missing
  /// here is not entitled, or names a source this build does not know.
  final Map<String, EpisodeEntitlementSource> entitlementSources;

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

  /// The plans the tenant sells, in the order it created them. A tenant that
  /// sells none answers an empty list. Needs no session.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<List<SubscriptionPlan>> subscriptionPlans();

  /// The signed-in reader's subscription, or `null` for a reader who has
  /// never subscribed. A guest holds none, so they are answered `null`
  /// without a request.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.sessionExpired] when the
  /// API no longer accepts the session.
  Future<MySubscription?> mySubscription();

  /// A page of the billing portal of the tenant's payment provider, where the
  /// signed-in reader changes their payment method, reads their invoices, and
  /// cancels the subscription the tenant's web checkout bills.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.notSold] when there is no
  /// portal to open: the reader never subscribed through the web checkout, or
  /// the tenant takes no payments through it.
  Future<Uri> startBillingPortal();

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

  /// Opens a purchase of the pack of the tenant's coins [coinPackId] names
  /// through [store] for the signed-in reader. Asking again for the same pack
  /// answers the same intent until a purchase consumes it.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.notSold] when the tenant
  /// has coins off, has stopped selling packs, or no longer sells this one,
  /// and when it does not sell through [store] right now.
  Future<StorePurchaseIntent> startCoinPackStorePurchase(
    String coinPackId,
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

  /// Opens a subscription to the plan [planId] names through [store] for the
  /// signed-in reader. Asking again for the same plan answers the same intent.
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.alreadyPurchased] when the
  /// reader already holds a plan, [PurchaseFailureKind.gone] when the plan is
  /// no longer published, and [PurchaseFailureKind.notSold] when the tenant
  /// does not sell it through [store] right now.
  Future<StorePurchaseIntent> startStoreSubscription(
    String planId,
    InAppPurchaseStore store,
  );

  /// Hands a transaction of a subscription [store] charged to the server,
  /// which verifies it with the store and records the reader's subscription,
  /// or records what the store has changed of one it has already. Its
  /// arguments are those of [confirmStorePurchase].
  ///
  /// Throws [PurchaseFailure]; [PurchaseFailureKind.otherAccount] for a
  /// subscription recorded for another account, which stays there, and
  /// [PurchaseFailureKind.network] for a store the server could not reach,
  /// which is confirmed again later.
  Future<void> confirmStoreSubscription({
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

/// Looks up the [PurchaseRepository], [CheckoutLauncher], [StorePurchaser],
/// and [StoreSubscriber] installed by [PubliraApp].
class PurchaseScope extends InheritedWidget {
  const PurchaseScope({
    super.key,
    this.repository,
    this.launcher,
    this.storePurchaser,
    this.storeSubscriber,
    required super.child,
  });

  final PurchaseRepository? repository;
  final CheckoutLauncher? launcher;

  /// `null` on a device with no store to buy through, which a tenant on the
  /// store route offers no purchase on.
  final StorePurchaser? storePurchaser;

  /// `null` on a device with no store to subscribe through, which a tenant on
  /// the store route offers no plan on.
  final StoreSubscriber? storeSubscriber;

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
      storePurchaser != oldWidget.storePurchaser ||
      storeSubscriber != oldWidget.storeSubscriber;
}
