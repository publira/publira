import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/tap.dart';

/// A list in a box that fits two and a bit of its rows, so the third one is
/// painted -- and therefore found -- with its centre below the fold.
Widget _listOfRows({required VoidCallback onThirdRowTapped}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(
        height: 230,
        child: ListView.builder(
          itemCount: 20,
          itemExtent: 100,
          itemBuilder: (context, index) => ListTile(
            key: ValueKey('row-$index'),
            title: Text('Row $index'),
            onTap: index == 2 ? onThirdRowTapped : null,
          ),
        ),
      ),
    ),
  );
}

/// A window-high list whose last row sits at the bottom of the screen, below a
/// row whose height [grown] changes. [shown] takes the last row away.
Widget _screenWithLastRow({
  required VoidCallback onLastRowTapped,
  required ValueNotifier<bool> grown,
  required ValueNotifier<bool> shown,
}) {
  return MaterialApp(
    home: Scaffold(
      body: ListView(
        children: [
          for (var index = 0; index < 8; index++)
            SizedBox(height: 70, child: Text('Row $index')),
          ValueListenableBuilder<bool>(
            valueListenable: grown,
            builder: (context, grown, _) => SizedBox(
              height: grown ? 160 : 60,
              child: const Text('Growing row'),
            ),
          ),
          ValueListenableBuilder<bool>(
            valueListenable: shown,
            builder: (context, shown, _) => shown
                ? ListTile(
                    key: const ValueKey('last-row'),
                    title: const Text('Last row'),
                    onTap: onLastRowTapped,
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    ),
  );
}

/// A button under a layer that takes every pointer for as long as [covered]
/// holds, the way a screen can still sit under another one for a few frames
/// after its own route has settled.
Widget _coveredButton({
  required VoidCallback onTapped,
  required ValueNotifier<bool> covered,
}) {
  return MaterialApp(
    home: Scaffold(
      body: Stack(
        children: [
          Center(
            child: TextButton(
              key: const ValueKey('button'),
              onPressed: onTapped,
              child: const Text('Button'),
            ),
          ),
          ValueListenableBuilder<bool>(
            valueListenable: covered,
            builder: (context, covered, _) => covered
                ? const Positioned.fill(
                    child: ColoredBox(
                      key: ValueKey('cover'),
                      color: Colors.white,
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    ),
  );
}

/// A window-high list of forty rows built from a `children:` list, which
/// builds only the rows near its viewport.
Widget _longList({required void Function(int index) onRowTapped}) {
  return MaterialApp(
    home: Scaffold(
      body: ListView(
        key: const ValueKey('long-list'),
        children: [
          for (var index = 0; index < 40; index++)
            ListTile(
              key: ValueKey('row-$index'),
              title: Text('Row $index'),
              onTap: () => onRowTapped(index),
            ),
        ],
      ),
    ),
  );
}

/// Runs [change] at the start of the next frame, which is the one tapVisible
/// pumps between bringing its target in and tapping it.
void onNextFrame(WidgetTester tester, VoidCallback change) {
  tester.binding.scheduleFrameCallback((_) => change());
}

void main() {
  testWidgets('taps a row whose centre the viewport cuts off', (tester) async {
    var tapped = false;
    await tester.pumpWidget(_listOfRows(onThirdRowTapped: () => tapped = true));

    final target = find.byKey(const ValueKey('row-2'));
    expect(target, findsOneWidget);
    expect(
      tester.getCenter(target).dy,
      greaterThan(tester.getRect(find.byType(ListView)).bottom),
    );

    await tapVisible(tester, target);

    expect(tapped, isTrue);
  });

  testWidgets('leaves a row that is already whole on screen where it is', (
    tester,
  ) async {
    var tapped = false;
    await tester.pumpWidget(_listOfRows(onThirdRowTapped: () => tapped = true));

    final onScreen = find.byKey(const ValueKey('row-0'));
    final before = tester.getRect(onScreen);

    await tapVisible(tester, onScreen);

    expect(tester.getRect(onScreen), before);
    expect(tapped, isFalse);
  });

  group('a row the list has not built', () {
    final list = find.descendant(
      of: find.byKey(const ValueKey('long-list')),
      matching: find.byType(Scrollable),
    );
    int? tapped;

    setUp(() => tapped = null);

    Future<void> pumpScrolledTo(WidgetTester tester, double offset) async {
      await tester.pumpWidget(
        _longList(onRowTapped: (index) => tapped = index),
      );
      tester.state<ScrollableState>(list).position.jumpTo(offset);
      await tester.pump();
    }

    testWidgets('is tapped after scrolling back up to it', (tester) async {
      await pumpScrolledTo(tester, 2000);
      final target = find.byKey(const ValueKey('row-1'));
      expect(target, findsNothing);

      await tapVisible(tester, target, scrollable: list);

      expect(tapped, 1);
    });

    testWidgets('is tapped after scrolling down to it', (tester) async {
      await pumpScrolledTo(tester, 0);
      final target = find.byKey(const ValueKey('row-38'));
      expect(target, findsNothing);

      await tapVisible(tester, target, scrollable: list);

      expect(tapped, 38);
    });

    testWidgets('fails naming the row when no list is given', (tester) async {
      await pumpScrolledTo(tester, 2000);

      await expectLater(
        tapVisible(tester, find.byKey(const ValueKey('row-1'))),
        throwsA(
          isA<TestFailure>().having(
            (failure) => failure.message,
            'message',
            allOf(contains('row-1'), contains('is not built')),
          ),
        ),
      );
      expect(tapped, isNull);
    });

    testWidgets('fails naming the row when the list does not hold it', (
      tester,
    ) async {
      await pumpScrolledTo(tester, 1000);

      TestFailure? failure;
      try {
        await tapVisible(
          tester,
          find.byKey(const ValueKey('row-40')),
          scrollable: list,
        );
      } on TestFailure catch (error) {
        failure = error;
      }

      expect(
        failure?.message,
        allOf(contains('row-40'), contains('at any scroll offset')),
      );
      expect(tapped, isNull);
    });
  });

  group('a row that moves while the tap is aimed', () {
    late ValueNotifier<bool> grown;
    late ValueNotifier<bool> shown;
    late bool tapped;

    setUp(() {
      grown = ValueNotifier(false);
      shown = ValueNotifier(true);
      tapped = false;
    });

    tearDown(() {
      grown.dispose();
      shown.dispose();
    });

    Future<void> pumpScreen(WidgetTester tester) async {
      tester.view.physicalSize = const Size(800, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _screenWithLastRow(
          onLastRowTapped: () => tapped = true,
          grown: grown,
          shown: shown,
        ),
      );
      expect(find.byKey(const ValueKey('last-row')), findsOneWidget);
    }

    testWidgets('is tapped after the soft keyboard shrinks the viewport', (
      tester,
    ) async {
      await pumpScreen(tester);

      // Lands on the frame tapVisible pumps after scrolling, the way a
      // keyboard a text field on an earlier screen asked for arrives late.
      onNextFrame(
        tester,
        () => tester.view.viewInsets = const FakeViewPadding(bottom: 200),
      );
      await tapVisible(tester, find.byKey(const ValueKey('last-row')));

      expect(tapped, isTrue);
    });

    testWidgets('is tapped after a row above it grows', (tester) async {
      await pumpScreen(tester);

      onNextFrame(tester, () => grown.value = true);
      await tapVisible(tester, find.byKey(const ValueKey('last-row')));

      expect(tapped, isTrue);
    });

    testWidgets('fails naming the row when it leaves the tree', (tester) async {
      await pumpScreen(tester);

      onNextFrame(tester, () => shown.value = false);
      await expectLater(
        tapVisible(tester, find.byKey(const ValueKey('last-row'))),
        throwsA(
          isA<TestFailure>().having(
            (failure) => failure.message,
            'message',
            contains('left the tree'),
          ),
        ),
      );
      expect(tapped, isFalse);
    });
  });
  group('a control something else still covers', () {
    late ValueNotifier<bool> covered;
    late bool tapped;

    setUp(() {
      covered = ValueNotifier(true);
      tapped = false;
      // As the integration suite runs, so a tap that misses fails here too.
      WidgetController.hitTestWarningShouldBeFatal = true;
    });

    tearDown(() {
      WidgetController.hitTestWarningShouldBeFatal = false;
      covered.dispose();
    });

    Future<void> pumpScreen(WidgetTester tester) => tester.pumpWidget(
      _coveredButton(onTapped: () => tapped = true, covered: covered),
    );

    testWidgets('is tapped once the cover lifts', (tester) async {
      await pumpScreen(tester);
      expect(find.byKey(const ValueKey('button')).hitTestable(), findsNothing);

      onNextFrame(tester, () => covered.value = false);
      await tapReachable(tester, find.byKey(const ValueKey('button')));

      expect(tapped, isTrue);
    });

    testWidgets('is tapped by tapVisible once the cover lifts', (tester) async {
      await pumpScreen(tester);

      // Past the frame tapVisible pumps after scrolling, so that frame alone
      // cannot be what lets the tap through.
      onNextFrame(
        tester,
        () => onNextFrame(tester, () => covered.value = false),
      );
      await tapVisible(tester, find.byKey(const ValueKey('button')));

      expect(tapped, isTrue);
    });

    testWidgets('fails naming what takes the pointer when it never lifts', (
      tester,
    ) async {
      await pumpScreen(tester);

      TestFailure? failure;
      try {
        await tapReachable(
          tester,
          find.byKey(const ValueKey('button')),
          timeout: const Duration(milliseconds: 200),
        );
      } on TestFailure catch (error) {
        failure = error;
      }

      expect(failure?.message, contains('takes the pointer instead'));
      expect(tapped, isFalse);
    });
  });
}
