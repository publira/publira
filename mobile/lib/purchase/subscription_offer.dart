import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// Where the tenant's site lists the plans it sells, which a locked episode
/// hands the reader to in the browser.
const subscriptionPlansPath = '/plans';

/// Whether a plan the tenant sells opens [detail]'s series, which is what
/// makes a locked episode offer the plans: a plan of the whole tenant, of the
/// series, or of the label the series is filed under.
///
/// The episode read does not name the series' label, so the series is read
/// for it, and only when a plan of labels could be the one that opens it.
/// Either read failing offers no plan, which leaves the gate as it is for a
/// tenant that sells none.
Future<bool> offersSubscriptionPlan({
  required PurchaseRepository purchase,
  required CatalogRepository catalog,
  required EpisodeDetail detail,
  required String locale,
}) async {
  if (detail.access != EpisodeAccess.locked) {
    return false;
  }
  final List<SubscriptionPlan> plans;
  try {
    plans = await purchase.subscriptionPlans();
  } on PurchaseFailure {
    return false;
  }
  if (plans.any((plan) => plan.opens(seriesId: detail.seriesId))) {
    return true;
  }
  if (!plans.any((plan) => plan.scope == SubscriptionPlanScope.label)) {
    return false;
  }
  final String labelId;
  try {
    labelId =
        (await catalog.getSeries(
          detail.seriesId,
          locale: locale,
        ))?.series.labelId ??
        '';
  } on CatalogFailure {
    return false;
  }
  return plans.any(
    (plan) => plan.opens(seriesId: detail.seriesId, labelId: labelId),
  );
}
