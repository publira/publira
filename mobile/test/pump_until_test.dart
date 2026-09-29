import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/pump_until.dart';

void main() {
  testWidgets('a round slowed by a loaded machine does not use up the wait', (
    tester,
  ) async {
    await tester.pumpWidget(const SizedBox());
    final start = tester.binding.clock.now();

    // Each check takes longer in real time than the whole wait allows on the
    // test's clock, the way every round does on a machine under load.
    await pumpUntilTrue(tester, () {
      sleep(const Duration(milliseconds: 150));
      return tester.binding.clock.now().difference(start) >=
          const Duration(milliseconds: 150);
    }, timeout: const Duration(milliseconds: 200));
  });

  testWidgets('gives up once the timeout has passed on the test clock', (
    tester,
  ) async {
    await tester.pumpWidget(const SizedBox());
    final start = tester.binding.clock.now();

    // expectLater is guarded like pump, so it cannot wrap a helper that pumps.
    TestFailure? failure;
    try {
      await pumpUntilTrue(
        tester,
        () => false,
        description: 'something that never happens',
        timeout: const Duration(seconds: 1),
      );
    } on TestFailure catch (error) {
      failure = error;
    }

    expect(
      failure?.message,
      'Timed out waiting for something that never happens',
    );
    expect(
      tester.binding.clock.now().difference(start),
      const Duration(seconds: 1),
    );
  });

  testWidgets('fails naming the finder when nothing matches it', (
    tester,
  ) async {
    await tester.pumpWidget(const SizedBox());

    TestFailure? failure;
    try {
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('never-built')),
        timeout: const Duration(seconds: 1),
      );
    } on TestFailure catch (error) {
      failure = error;
    }

    expect(
      failure?.message,
      "Timed out waiting for Found 0 widgets with key [<'never-built'>]: []",
    );
  });
}
