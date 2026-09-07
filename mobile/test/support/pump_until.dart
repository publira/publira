import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pumps until [finder] matches, instead of [WidgetTester.pumpAndSettle].
///
/// A [CircularProgressIndicator] never goes idle, so `pumpAndSettle` hangs
/// while a catalog request is in flight.
Future<void> pumpUntilFound(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
    if (finder.evaluate().isNotEmpty) {
      return;
    }
  }
  fail('Timed out waiting for $finder');
}

/// Pumps until [condition] holds, for state no widget reveals — an image
/// request the fixture server has recorded, say, which lands after the widget
/// that triggered it is already on screen.
Future<void> pumpUntilTrue(
  WidgetTester tester,
  bool Function() condition, {
  String description = 'condition',
  Duration timeout = const Duration(seconds: 10),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
    if (condition()) {
      return;
    }
  }
  fail('Timed out waiting for $description');
}

/// Pumps until [finder] matches and the route holding it has stopped moving,
/// for a step that is about to tap or type on that screen.
///
/// [pumpUntilFound] returns on the first frame the widget exists, and that is
/// already true while the route carrying it animates in. A route ignores
/// pointer events and the navigator absorbs them for as long as a transition
/// runs, so a tap sent then is dropped and the screen it was meant to open
/// never arrives. A route's own animations are the wait that cannot return
/// mid-transition: [ModalRoute.animation] is completed only once the route is
/// fully in, and [ModalRoute.secondaryAnimation] is dismissed only once
/// whatever covered it has finished leaving.
///
/// The route [finder] matches has to be the one on top, which is what a test
/// about to interact with it wants: a widget on a route another one covers
/// keeps a completed secondary animation and never settles.
Future<void> pumpUntilRouteSettled(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  await pumpUntilFound(tester, finder, timeout: timeout);
  await pumpUntilTrue(
    tester,
    () => tester.elementList(finder).every(_isRouteSettled),
    description: 'the route holding $finder to finish transitioning',
    timeout: timeout,
  );
}

/// Whether the route [element] sits on takes part in no transition any more,
/// including one a reader is still dragging with a back gesture.
bool _isRouteSettled(Element element) {
  final route = ModalRoute.of(element);
  if (route == null) {
    return true;
  }
  if (route.navigator?.userGestureInProgress ?? false) {
    return false;
  }
  return (route.animation?.isCompleted ?? true) &&
      (route.secondaryAnimation?.isDismissed ?? true);
}

/// Pumps until no transient frame callback is left registered.
///
/// `PageView` reports its new page halfway through the turn animation, and
/// `ScrollAwareImageProvider` keeps rescheduling the incoming page's image
/// resolution on a frame callback for as long as the scroll is fast. A test
/// that ends as soon as the page number changes therefore leaves that callback
/// behind, and the binding reports it as an animation that outlived the widget
/// tree once the test tears the tree down.
Future<void> pumpUntilNoPendingFrameCallbacks(
  WidgetTester tester, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  await pumpUntilTrue(
    tester,
    () => SchedulerBinding.instance.transientCallbackCount == 0,
    description: 'the pending frame callbacks to drain',
    timeout: timeout,
  );
}

/// [pumpUntilTrue] for state only an asynchronous read can see, such as what
/// the offline library has written to the device.
Future<void> pumpUntilTrueAsync(
  WidgetTester tester,
  Future<bool> Function() condition, {
  String description = 'condition',
  Duration timeout = const Duration(seconds: 10),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
    if (await condition()) {
      return;
    }
  }
  fail('Timed out waiting for $description');
}
