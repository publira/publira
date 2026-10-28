import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'pump_until.dart';
import 'tap.dart';

/// The catalog's own list, which runs down the screen under the shelves that
/// scroll across it.
Finder catalogList() => find
    .byWidgetPredicate(
      (widget) =>
          widget is Scrollable && widget.axisDirection == AxisDirection.down,
    )
    .first;

/// Taps [viewAll], the "View all" of a catalog shelf, once the shelf has read
/// its cards.
///
/// The shelf shows its action only once it has cards, and by then it can be
/// anywhere on the catalog: the sections above it change height as they finish
/// loading — the campaign banners arrive, a shelf's heading gains its own View
/// all — and push it below the fold, where a finder no longer matches what it
/// holds. Seeing the shelf on screen while it was still read therefore says
/// nothing about where its action will be, so the wait does not ask for the
/// action to be on screen, and the tap scrolls the catalog to it.
Future<void> openShelfList(
  WidgetTester tester,
  Key viewAll, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  await pumpUntilRouteSettled(
    tester,
    find.byKey(viewAll, skipOffstage: false),
    timeout: timeout,
  );
  await tapVisible(tester, find.byKey(viewAll), scrollable: catalogList());
}
