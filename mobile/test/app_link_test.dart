import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/router.dart';

void main() {
  const host = 'shop.example';
  const site = PublicSite(host: host, defaultLocale: 'ja');

  group('appLocationFor', () {
    test('a series URL on the tenant host is the series path', () {
      expect(
        appLocationFor(
          Uri.parse('https://shop.example/series/SERIES01'),
          tenantHost: host,
        ),
        '/series/SERIES01',
      );
    });

    test('an episode URL is the viewer path', () {
      expect(
        appLocationFor(
          Uri.parse('https://shop.example/series/SERIES01/episodes/EPISODE01'),
          tenantHost: host,
        ),
        '/series/SERIES01/episodes/EPISODE01',
      );
    });

    test('a comments URL is the comments path', () {
      expect(
        appLocationFor(
          Uri.parse(
            'https://shop.example/series/SERIES01/episodes/EPISODE01/comments',
          ),
          tenantHost: host,
        ),
        '/series/SERIES01/episodes/EPISODE01/comments',
      );
    });

    test('a locale prefix the catalogs know is stripped', () {
      const cases = {
        'https://shop.example/en/series/SERIES01': '/series/SERIES01',
        'https://shop.example/ja/series/SERIES01': '/series/SERIES01',
        'https://shop.example/ko/series/SERIES01/episodes/EPISODE01':
            '/series/SERIES01/episodes/EPISODE01',
        'https://shop.example/zh-Hans/series/SERIES01': '/series/SERIES01',
        'https://shop.example/zh-Hant/series/SERIES01': '/series/SERIES01',
      };

      for (final entry in cases.entries) {
        expect(
          appLocationFor(Uri.parse(entry.key), tenantHost: host),
          entry.value,
          reason: entry.key,
        );
      }
    });

    test('a checkout return keeps the query the browser sent', () {
      expect(
        appLocationFor(
          Uri.parse(
            'https://shop.example/en/checkout/return?episode=EPISODE01&status=success',
          ),
          tenantHost: host,
        ),
        '/checkout/return?episode=EPISODE01&status=success',
      );
    });

    test('http is accepted the same way https is', () {
      expect(
        appLocationFor(
          Uri.parse('http://shop.example/series/SERIES01'),
          tenantHost: host,
        ),
        '/series/SERIES01',
      );
    });

    test('a host this build is not pinned to is refused', () {
      expect(
        appLocationFor(
          Uri.parse('https://other.example/series/SERIES01'),
          tenantHost: host,
        ),
        isNull,
      );
    });

    test('a path the app cannot open is refused', () {
      const cases = [
        'https://shop.example/',
        'https://shop.example/search',
        'https://shop.example/about',
        'https://shop.example/series/',
        'https://shop.example/series/SERIES01/episodes',
        'https://shop.example/series/SERIES01/episodes/',
        'https://shop.example/en/settings',
      ];

      for (final uri in cases) {
        expect(
          appLocationFor(Uri.parse(uri), tenantHost: host),
          isNull,
          reason: uri,
        );
      }
    });

    test('a scheme the site does not use is refused', () {
      expect(
        appLocationFor(
          Uri.parse('publira://shop.example/series/SERIES01'),
          tenantHost: host,
        ),
        isNull,
      );
    });

    test('a tenant host that names a port still matches the host', () {
      expect(
        appLocationFor(
          Uri.parse('https://localhost/series/SERIES01'),
          tenantHost: 'localhost:3080',
        ),
        '/series/SERIES01',
      );
    });
  });

  group('PublicSite.uriFor', () {
    test('the default locale is unprefixed', () {
      expect(
        site.uriFor(AppRoutes.seriesDetailPath('SERIES01'), locale: 'ja'),
        Uri.parse('https://shop.example/series/SERIES01'),
      );
    });

    test('a non-default locale carries its prefix', () {
      expect(
        site.uriFor(AppRoutes.seriesDetailPath('SERIES01'), locale: 'en'),
        Uri.parse('https://shop.example/en/series/SERIES01'),
      );
    });

    test('an unknown default locale is unprefixed', () {
      const unknown = PublicSite(host: host);
      expect(
        unknown.uriFor(AppRoutes.seriesDetailPath('SERIES01'), locale: 'en'),
        Uri.parse('https://shop.example/series/SERIES01'),
      );
    });

    test('an episode path keeps its segments under the prefix', () {
      expect(
        site.uriFor(
          AppRoutes.episodeViewerPath('SERIES01', 'EPISODE01'),
          locale: 'en',
        ),
        Uri.parse('https://shop.example/en/series/SERIES01/episodes/EPISODE01'),
      );
    });
  });

  test('a share of a credited work names the work and its people', () {
    final messages = AppMessages.forLocale(const Locale('en'))!;
    expect(
      shareMessage(
        messages,
        title: 'Seed Series',
        creatorNames: const ['Ada', 'Bea', 'Cyd'],
      ),
      'Seed Series by Ada, Bea, and Cyd',
    );
  });

  test('a share of a work credited to nobody is the title alone', () {
    final messages = AppMessages.forLocale(const Locale('en'))!;
    expect(
      shareMessage(messages, title: 'Seed Series', creatorNames: const []),
      'Seed Series',
    );
  });
}
