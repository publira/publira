import 'package:flutter_test/flutter_test.dart';
import 'package:publira/viewer/page_spreads.dart';

void main() {
  const single = PageSpreads(pageCount: 5, paired: false);
  const paired = PageSpreads(pageCount: 5, paired: true);

  test('one page per screen without pairing', () {
    expect(single.length, 5);
    expect(single.pagesAt(0), [0]);
    expect(single.pagesAt(4), [4]);
    expect(single.spreadOf(3), 3);
    expect(single.firstPageOf(3), 3);
  });

  test('the cover keeps its screen and pairing starts after it', () {
    expect(paired.length, 3);
    expect(paired.pagesAt(0), [0]);
    expect(paired.pagesAt(1), [1, 2]);
    expect(paired.pagesAt(2), [3, 4]);
  });

  test('a page and the screen it sits on refer to each other', () {
    expect(
      [for (var page = 0; page < 5; page++) paired.spreadOf(page)],
      [0, 1, 1, 2, 2],
    );
    expect(
      [for (var spread = 0; spread < 3; spread++) paired.firstPageOf(spread)],
      [0, 1, 3],
    );
  });

  test('an even page count ends on a single page', () {
    const even = PageSpreads(pageCount: 4, paired: true);
    expect(even.length, 3);
    expect(even.pagesAt(2), [3]);
  });

  test('an episode shorter than a spread stays one page per screen', () {
    expect(const PageSpreads(pageCount: 1, paired: true).length, 1);
    expect(const PageSpreads(pageCount: 1, paired: true).pagesAt(0), [0]);
    expect(const PageSpreads(pageCount: 0, paired: true).length, 0);
  });

  test('pairing from the first page puts two pages on the opening screen', () {
    const fromFirst = PageSpreads(
      pageCount: 5,
      paired: true,
      spreadStartIndex: 0,
    );
    expect(fromFirst.length, 3);
    expect(fromFirst.pagesAt(0), [0, 1]);
    expect(fromFirst.pagesAt(1), [2, 3]);
    expect(fromFirst.pagesAt(2), [4]);
    expect(
      [for (var page = 0; page < 5; page++) fromFirst.spreadOf(page)],
      [0, 0, 1, 1, 2],
    );
  });

  test('an even page count pairing from the first page fills every screen', () {
    const even = PageSpreads(pageCount: 4, paired: true, spreadStartIndex: 0);
    expect(even.length, 2);
    expect(even.pagesAt(0), [0, 1]);
    expect(even.pagesAt(1), [2, 3]);
  });

  test('a spread start past the last page stays one page per screen', () {
    const past = PageSpreads(pageCount: 3, paired: true, spreadStartIndex: 5);
    expect(past.length, 3);
    expect(past.pagesAt(0), [0]);
    expect(past.pagesAt(2), [2]);
  });
}
