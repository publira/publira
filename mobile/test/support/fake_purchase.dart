import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/checkout_launcher.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// In-memory [PurchaseRepository] for widget tests.
class FakePurchaseRepository implements PurchaseRepository {
  FakePurchaseRepository({
    this.payments = true,
    this.access = const {},
    this.seriesByEpisode = const {},
    this.checkoutFailure,
  });

  /// What [acceptsPayments] answers.
  bool payments;

  /// What [seriesEpisodeAccess] answers, whichever series is asked about.
  Map<String, EpisodeAccess> access;

  /// What [seriesOfEpisode] answers from, looked up by episode public id.
  Map<String, String> seriesByEpisode;

  /// Thrown by [seriesOfEpisode], standing in for an API that cannot answer.
  PurchaseFailure? seriesFailure;

  /// Thrown by [startEpisodeCheckout].
  PurchaseFailure? checkoutFailure;

  /// Episodes [startEpisodeCheckout] was asked for, in order.
  final List<String> checkouts = <String>[];

  @override
  Future<bool> acceptsPayments() async => payments;

  @override
  Future<Map<String, EpisodeAccess>> seriesEpisodeAccess(
    String seriesPublicId,
  ) async => access;

  @override
  Future<String?> seriesOfEpisode(String episodePublicId) async {
    final failure = seriesFailure;
    if (failure != null) {
      throw failure;
    }
    return seriesByEpisode[episodePublicId];
  }

  @override
  Future<Uri> startEpisodeCheckout(String episodePublicId) async {
    checkouts.add(episodePublicId);
    final failure = checkoutFailure;
    if (failure != null) {
      throw failure;
    }
    return checkoutUrlFor(episodePublicId);
  }

  static Uri checkoutUrlFor(String episodePublicId) =>
      Uri.parse('https://checkout.stripe.test/c/pay/$episodePublicId');
}

/// A [CheckoutLauncher] a test reads, so a purchase can be asserted without a
/// browser.
class FakeCheckoutLauncher implements CheckoutLauncher {
  FakeCheckoutLauncher({this.opens = true});

  /// What [open] answers.
  bool opens;

  final List<Uri> opened = <Uri>[];

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return opens;
  }
}
