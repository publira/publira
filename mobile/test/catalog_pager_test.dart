import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_pager.dart';

void main() {
  group('refresh', () {
    test('completes once the first page has answered', () async {
      final answer = Completer<CatalogPageRead<int, Null>?>();
      final pager = CatalogPager<int, Null>((token) => answer.future);
      addTearDown(pager.dispose);

      var refreshed = false;
      unawaited(pager.refresh().then((_) => refreshed = true));
      await pumpEventQueue();
      expect(refreshed, isFalse);

      answer.complete(const CatalogPageRead(items: [1]));
      await pumpEventQueue();
      expect(refreshed, isTrue);
      expect(pager.items, [1]);
    });

    test('completes when the first page fails', () async {
      final pager = CatalogPager<int, Null>(
        (token) async => throw const CatalogFailure(CatalogFailureKind.network),
      );
      addTearDown(pager.dispose);

      await pager.refresh();

      expect(pager.failure?.kind, CatalogFailureKind.network);
    });

    test('completes when the pager is cleared before it answers', () async {
      final answer = Completer<CatalogPageRead<int, Null>?>();
      final pager = CatalogPager<int, Null>((token) => answer.future);
      addTearDown(pager.dispose);

      var refreshed = false;
      unawaited(pager.refresh().then((_) => refreshed = true));
      pager.clear();
      await pumpEventQueue();

      expect(refreshed, isTrue);
    });
  });
}
