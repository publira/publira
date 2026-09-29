import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/viewer/page_fit.dart';

void main() {
  const viewport = Size(400, 800);

  test('a taller page is bound by the viewport height', () {
    final size = fitPageSize(viewport: viewport, page: const Size(800, 2400));
    expect(size.width, moreOrLessEquals(800 / 3));
    expect(size.height, moreOrLessEquals(800));
  });

  test('a wider page is bound by the viewport width', () {
    expect(
      fitPageSize(viewport: viewport, page: const Size(1600, 800)),
      const Size(400, 200),
    );
  });

  test('a page smaller than the viewport is scaled up to fit', () {
    expect(
      fitPageSize(viewport: viewport, page: const Size(200, 200)),
      const Size(400, 400),
    );
  });

  test('a page with no stored size takes the whole viewport', () {
    expect(fitPageSize(viewport: viewport, page: Size.zero), viewport);
    expect(fitPageSize(viewport: viewport, page: const Size(800, 0)), viewport);
  });

  test('an unmeasured viewport reserves nothing', () {
    expect(
      fitPageSize(viewport: Size.zero, page: const Size(800, 1200)),
      Size.zero,
    );
  });
}
