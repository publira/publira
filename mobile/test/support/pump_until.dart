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
