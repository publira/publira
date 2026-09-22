import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/announcements/announcement_link.dart';
import 'package:publira/announcements/dismissed_announcement_store.dart';
import 'package:publira/links/app_link.dart';

void main() {
  const site = PublicSite(host: 'shop.example', defaultLocale: 'ja');

  AnnouncementDestination? destination(
    String linkUrl, {
    String locale = 'ja',
  }) => announcementDestination(linkUrl, site: site, locale: locale);

  String? inApp(String linkUrl) => switch (destination(linkUrl)) {
    InAppAnnouncementDestination(:final location) => location,
    _ => null,
  };

  Uri? external(String linkUrl, {String locale = 'ja'}) =>
      switch (destination(linkUrl, locale: locale)) {
        ExternalAnnouncementDestination(:final url) => url,
        _ => null,
      };

  group('an announcement link', () {
    test('opens a path the app has a screen for in the app', () {
      expect(inApp('/series/SR01'), '/series/SR01');
      expect(inApp('/series/SR01/episodes/EP01'), '/series/SR01/episodes/EP01');
      expect(inApp('/announcements'), '/announcements');
    });

    test('drops a locale prefix the operator wrote', () {
      expect(inApp('/en/series/SR01'), '/series/SR01');
    });

    test('opens a URL on the tenant host in the app', () {
      expect(inApp('https://shop.example/ko/series/SR01'), '/series/SR01');
    });

    test('hands a path the app has no screen for to the tenant site', () {
      expect(external('/about'), Uri.parse('https://shop.example/about'));
      expect(
        external('/about?tab=faq', locale: 'en'),
        Uri.parse('https://shop.example/en/about?tab=faq'),
      );
    });

    test('hands another site to the browser', () {
      expect(
        external('https://elsewhere.example/news'),
        Uri.parse('https://elsewhere.example/news'),
      );
    });

    test('refuses what the site refuses', () {
      expect(destination(''), isNull);
      expect(destination('//evil.example/path'), isNull);
      expect(destination(r'/\evil.example'), isNull);
      expect(destination('javascript:alert(1)'), isNull);
      expect(destination('series/SR01'), isNull);
      expect(destination('/${'a' * 2048}'), isNull);
    });
  });

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
