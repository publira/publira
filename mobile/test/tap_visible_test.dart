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
}
