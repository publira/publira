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
/// list; a control that belongs to the screen itself goes through
/// [tapReachable], whose wait this also makes before tapping.
///
/// The frame pumped after scrolling can push the row off screen again, as a
/// late soft keyboard or a row above it growing does, so the row is held by
/// its element and scrolled back in until a frame leaves it whole.
///
/// For the same reason a row the list has scrolled out of view is not matched
/// at all, whether the list still holds it in its cache extent or has not
/// built it, so there is no element to scroll to. Pass that list as
/// [scrollable] and it is scrolled until [finder] matches; without it, the tap
/// fails naming [finder].
Future<void> tapVisible(
  WidgetTester tester,
  Finder finder, {
  Finder? scrollable,
  Duration timeout = const Duration(seconds: 10),
}) async {
  if (finder.evaluate().isEmpty) {
    if (scrollable == null) {
      fail(
        '$finder is not on screen; pass the list that holds it as scrollable',
      );
    }
    await _scrollUntilMatched(tester, finder, scrollable);
  }
  final element = tester.element(finder);
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await Scrollable.ensureVisible(element);
    await tester.pump();
    if (!element.mounted) {
      fail('$finder left the tree while a tap was being aimed at it');
    }
    if (_isWholeOnScreen(element) && _isReachable(finder)) {
      await tester.tap(finder);
      return;
    }
  }
  fail('Timed out waiting for $finder to stay whole on screen and reachable');
}

/// Taps what [finder] matches once a pointer at its centre would reach it.
///
/// A settled route can still sit under something drawn above it for a few
/// frames, which takes the pointer instead, so this waits out the same hit test
/// [WidgetTester.tap] would only report after sending the tap.
Future<void> tapReachable(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final end = DateTime.now().add(timeout);
  while (!_isReachable(finder)) {
    if (!DateTime.now().isBefore(end)) {
      fail(
        'Timed out waiting for a tap on $finder to reach it; '
        '${_topHit(tester, finder)} takes the pointer instead',
      );
    }
    await tester.pump(const Duration(milliseconds: 50));
  }
  await tester.tap(finder);
}

bool _isReachable(Finder finder) => finder.hitTestable().evaluate().isNotEmpty;

/// What a tap at the centre of [finder] hits first, for a failure message.
Object _topHit(WidgetTester tester, Finder finder) {
  if (finder.evaluate().isEmpty) {
    return 'nothing matching it';
  }
  final path = tester.hitTestOnBinding(tester.getCenter(finder)).path;
  return path.isEmpty ? 'nothing' : path.first.target;
}

/// Scrolls [scrollable] toward its start and then toward its end until
/// [finder] matches.
///
/// Each step moves one viewport, which never passes over a row without
/// painting it, and the start comes first because the row may lie either way.
Future<void> _scrollUntilMatched(
  WidgetTester tester,
  Finder finder,
  Finder scrollable,
) async {
  final position = tester.state<ScrollableState>(scrollable).position;
  for (final forward in [false, true]) {
    while (finder.evaluate().isEmpty) {
      final limit = forward
          ? position.maxScrollExtent
          : position.minScrollExtent;
      if (position.pixels == limit) {
        break;
      }
      final step = forward
          ? position.viewportDimension
          : -position.viewportDimension;
      position.jumpTo(
        (position.pixels + step).clamp(
          position.minScrollExtent,
          position.maxScrollExtent,
        ),
      );
      await tester.pump();
    }
    if (finder.evaluate().isNotEmpty) {
      return;
    }
  }
  fail('$finder is not in $scrollable at any scroll offset');
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

/// [WidgetTester.pageBack] through [tapReachable].
Future<void> tapBack(WidgetTester tester) =>
    tapReachable(tester, find.byTooltip('Back'));
