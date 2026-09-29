import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/announcements/dismissed_announcement_store.dart';

void main() {
  group('the dismissed banner file', () {
    late Directory root;

    setUp(() async {
      root = await Directory.systemTemp.createTemp('dismissed-announcement');
    });

    tearDown(() async {
      await root.delete(recursive: true);
    });

    test('reads empty before anything was closed', () async {
      final store = FileDismissedAnnouncementStore(root: () async => root);

      expect(await store.read(), isEmpty);
    });

    test('keeps the last banner closed', () async {
      final store = FileDismissedAnnouncementStore(root: () async => root);

      await store.write('a-1');
      await store.write('a-2');

      expect(
        await FileDismissedAnnouncementStore(root: () async => root).read(),
        'a-2',
      );
    });
  });
}
