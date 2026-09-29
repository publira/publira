import 'package:flutter_test/flutter_test.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/links/tenant_link.dart';

void main() {
  const site = PublicSite(host: 'shop.example', defaultLocale: 'ja');

  TenantLinkDestination? destination(String linkUrl, {String locale = 'ja'}) =>
      tenantLinkDestination(linkUrl, site: site, locale: locale);

  String? inApp(String linkUrl) => switch (destination(linkUrl)) {
    InAppDestination(:final location) => location,
    _ => null,
  };

  (String, Uri)? sitePath(String linkUrl, {String locale = 'ja'}) =>
      switch (destination(linkUrl, locale: locale)) {
        SitePathDestination(:final path, :final url) => (path, url),
        _ => null,
      };

  Uri? external(String linkUrl) => switch (destination(linkUrl)) {
    ExternalDestination(:final url) => url,
    _ => null,
  };

  group('a link a tenant wrote', () {
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

    test('keeps a path the app has no screen for on the tenant site', () {
      expect(sitePath('/about'), (
        '/about',
        Uri.parse('https://shop.example/about'),
      ));
      expect(sitePath('/en/legal/terms?tab=faq', locale: 'en'), (
        '/legal/terms',
        Uri.parse('https://shop.example/en/legal/terms?tab=faq'),
      ));
      expect(sitePath('https://shop.example/ko/privacy'), (
        '/privacy',
        Uri.parse('https://shop.example/ko/privacy'),
      ));
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
}
