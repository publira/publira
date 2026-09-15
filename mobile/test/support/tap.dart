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
/// [WidgetTester.ensureVisible] scrolls the row fully in, and a row already
/// whole on screen does not move. Use this wherever the target is a row of a
/// list; a control that belongs to the screen itself needs nothing.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}
