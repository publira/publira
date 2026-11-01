import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';

/// Where the tenant's site lists the plans it sells, which a locked episode
/// hands the reader to in the browser.
const subscriptionPlansPath = '/plans';

/// The plans the tenant sells that open [detail]'s series, which is what
/// makes a locked episode offer the plans: a plan of the whole tenant, of the
/// series, or of the label the series is filed under. They are in the order
/// the tenant created them.
///
/// The episode read does not name the series' label, so the series is read
/// for it, and only when a plan of labels could be one that opens it. The
/// plans failing to read answers none, which leaves the gate as it is for a
/// tenant that sells none.
Future<List<SubscriptionPlan>> subscriptionPlansOpening({
  required PurchaseRepository purchase,
  required CatalogRepository catalog,
  required EpisodeDetail detail,
  required String locale,
}) async {
  if (detail.access != EpisodeAccess.locked) {
    return const [];
  }
  final List<SubscriptionPlan> plans;
  try {
    plans = await purchase.subscriptionPlans();
  } on PurchaseFailure {
    return const [];
  }
  var labelId = '';
  if (plans.any((plan) => plan.scope == SubscriptionPlanScope.label)) {
    try {
      labelId =
          (await catalog.getSeries(
            detail.seriesId,
            locale: locale,
          ))?.series.labelId ??
          '';
    } on CatalogFailure {
      // The plans of labels are left out, and the others still open it.
    }
  }
  return List.unmodifiable(
    plans.where(
      (plan) => plan.opens(seriesId: detail.seriesId, labelId: labelId),
    ),
  );
}
