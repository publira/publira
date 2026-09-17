import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/pump_until.dart';

const _tileKey = ValueKey('episode-tile');

/// Pushes a route whose transition outlasts the moment [_Tile] is removed, so
/// the removal lands while the helper is still waiting for the route.
Future<void> _pushSlowRoute(
  WidgetTester tester, {
  required Duration removeTileAfter,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push(
            PageRouteBuilder<void>(
              transitionDuration: const Duration(seconds: 1),
              pageBuilder: (_, _, _) => _Tile(removeAfter: removeTileAfter),
            ),
          ),
          child: const Text('Open'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open'));
}

class _Tile extends StatefulWidget {
  const _Tile({required this.removeAfter});

  final Duration removeAfter;

  @override
  State<_Tile> createState() => _TileState();
}

class _TileState extends State<_Tile> {
  late final Timer _timer;
  var _shown = true;

  @override
  void initState() {
    super.initState();
    _timer = Timer(widget.removeAfter, () => setState(() => _shown = false));
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _shown
          ? const SizedBox(key: _tileKey, width: 100, height: 100)
          : const SizedBox.shrink(),
    );
  }
}

void main() {
  testWidgets('returns once the route holding the widget is fully in', (
    tester,
  ) async {
    await _pushSlowRoute(tester, removeTileAfter: const Duration(days: 1));

    final tile = find.byKey(_tileKey);
    await pumpUntilRouteSettled(tester, tile);

    expect(tile, findsOneWidget);
    expect(ModalRoute.of(tester.element(tile))!.animation!.isCompleted, isTrue);
  });

  testWidgets('fails naming the finder when the widget leaves the tree', (
    tester,
  ) async {
    await _pushSlowRoute(
      tester,
      removeTileAfter: const Duration(milliseconds: 200),
    );

    // expectLater is guarded like pump, so it cannot wrap a helper that pumps.
    TestFailure? failure;
    try {
      await pumpUntilRouteSettled(
        tester,
        find.byKey(_tileKey),
        timeout: const Duration(seconds: 1),
      );
    } on TestFailure catch (error) {
      failure = error;
    }

    expect(failure?.message, contains("'episode-tile'"));
  });
}
