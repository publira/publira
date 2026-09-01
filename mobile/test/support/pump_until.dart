import 'package:flutter/scheduler.dart';
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
