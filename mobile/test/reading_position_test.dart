import 'package:flutter_test/flutter_test.dart';
import 'package:publira/viewer/reading_position.dart';

void main() {
  group('resumePageIndex', () {
    test('a reader who stopped nowhere opens on the first page', () {
      expect(resumePageIndex(null, 10), 0);
    });

    test('a saved page is where the reader opens', () {
      expect(resumePageIndex(11, 20), 11);
    });

    test('a position past a shortened body opens on its last page', () {
      expect(resumePageIndex(11, 5), 4);
    });

    test('an episode with no pages opens at zero', () {
      expect(resumePageIndex(11, 0), 0);
    });
  });

  group('ReadingPositionSaver', () {
    /// A delay long enough that a test can pump inside it, and short enough
    /// that pumping past it is one line.
    const delay = Duration(milliseconds: 100);

    testWidgets('a page is recorded once the reader stays on it', (
      tester,
    ) async {
      final sent = <int>[];
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async => sent.add(pageIndex),
      );
      addTearDown(saver.dispose);

      saver.save(3);
      await tester.pump(delay ~/ 2);
      expect(sent, isEmpty);

      await tester.pump(delay);
      expect(sent, [3]);
    });

    testWidgets('pages turned inside the delay are recorded once', (
      tester,
    ) async {
      final sent = <int>[];
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async => sent.add(pageIndex),
      );
      addTearDown(saver.dispose);

      saver
        ..save(1)
        ..save(2)
        ..save(3);
      await tester.pump(delay * 2);

      expect(sent, [3]);
    });

    testWidgets('turning back to the recorded page sends nothing', (
      tester,
    ) async {
      final sent = <int>[];
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async => sent.add(pageIndex),
      );
      addTearDown(saver.dispose);

      saver.save(3);
      await tester.pump(delay * 2);
      saver
        ..save(4)
        ..save(3);
      await tester.pump(delay * 2);

      expect(sent, [3]);
    });

    testWidgets('flush records the page the reader left on', (tester) async {
      final sent = <int>[];
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async => sent.add(pageIndex),
      );
      addTearDown(saver.dispose);

      saver
        ..save(7)
        ..flush();
      await tester.pump();

      expect(sent, [7]);
    });

    testWidgets('a page that could not be recorded is sent again', (
      tester,
    ) async {
      final sent = <int>[];
      var failing = true;
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async {
          sent.add(pageIndex);
          if (failing) {
            throw StateError('the API could not be reached');
          }
        },
      );
      addTearDown(saver.dispose);

      saver.save(3);
      await tester.pump(delay * 2);
      failing = false;
      saver.save(3);
      await tester.pump(delay * 2);

      expect(sent, [3, 3]);
    });

    testWidgets('a saver disposed inside the delay records nothing', (
      tester,
    ) async {
      final sent = <int>[];
      final saver = ReadingPositionSaver(
        delay: delay,
        send: (pageIndex) async => sent.add(pageIndex),
      )..save(3);

      saver.dispose();
      await tester.pump(delay * 2);

      expect(sent, isEmpty);
    });
  });
}
