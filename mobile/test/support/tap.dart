import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Taps what [finder] matches, after bringing all of it onto the screen.
///
/// A row a [Finder] matches is not necessarily a row a reader could touch. A
/// finder skips what a viewport does not paint, but a row the viewport cuts in
/// half is painted and so is matched, while [WidgetTester.tap] aims at the
/// row's own centre — a point below the fold, where the hit test finds whatever
/// is drawn there instead. The tap is then delivered to something else, the
/// screen it was meant to open never arrives, and the run fails on whatever the
/// next step waited for rather than on the tap.
///
/// [Scrollable.ensureVisible] scrolls the row fully in, and a row already
/// whole on screen does not move. Use this wherever the target is a row of a
/// list; a control that belongs to the screen itself needs nothing.
///
/// The frame pumped after scrolling can push the row off screen again, as a
/// late soft keyboard or a row above it growing does, so the row is held by
/// its element and scrolled back in until a frame leaves it whole.
Future<void> tapVisible(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final element = tester.element(finder);
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await Scrollable.ensureVisible(element);
    await tester.pump();
    if (!element.mounted) {
      fail('$finder left the tree while a tap was being aimed at it');
    }
    if (_isWholeOnScreen(element)) {
      await tester.tap(finder);
      return;
    }
  }
  fail('Timed out waiting for $finder to stay whole on screen');
}

/// Whether [element] lies entirely inside every scrollable that holds it.
bool _isWholeOnScreen(Element element) {
  final rect = _globalRect(element);
  if (rect == null) {
    return false;
  }
  var scrollable = Scrollable.maybeOf(element);
  while (scrollable != null) {
    final bounds = _globalRect(scrollable.context);
    if (bounds == null || bounds.intersect(rect) != rect) {
      return false;
    }
    scrollable = Scrollable.maybeOf(scrollable.context);
  }
  return true;
}

Rect? _globalRect(BuildContext context) {
  final box = context.findRenderObject();
  if (box is! RenderBox || !box.attached || !box.hasSize) {
    return null;
  }
  return MatrixUtils.transformRect(
    box.getTransformTo(null),
    Offset.zero & box.size,
  );
}
