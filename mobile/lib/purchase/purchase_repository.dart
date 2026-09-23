import 'package:flutter/widgets.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/purchase/checkout_launcher.dart';

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

/// Paid-episode checkout through the public site's Stripe Checkout.
abstract class PurchaseRepository {
  /// Whether the tenant can take a payment right now. A tenant that cannot is
  /// offered no purchase, whatever the episode costs.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<bool> acceptsPayments();

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

  /// The page of the signed-in reader's purchases [token] names, newest
  /// first, and the first page for an empty one. A guest has bought nothing,
  /// so they are answered [MyPurchasePage.empty] without a request.
  ///
  /// Throws [PurchaseFailure] on a transport or unexpected server error.
  Future<MyPurchasePage> listMyPurchases({String token = ''});
}

/// Looks up the [PurchaseRepository] and [CheckoutLauncher] installed by
/// [PubliraApp].
class PurchaseScope extends InheritedWidget {
  const PurchaseScope({
    super.key,
    this.repository,
    this.launcher,
    required super.child,
  });

  final PurchaseRepository? repository;
  final CheckoutLauncher? launcher;

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
      repository != oldWidget.repository || launcher != oldWidget.launcher;
}
