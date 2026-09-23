import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/pages/page_failure.dart';
import 'package:publira/pages/published_page.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_links.dart';
import 'support/fake_page_repository.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;

  late GoRouter router;
  late FakePageRepository pages;
  late FakeExternalBrowser browser;

  setUp(() {
    pages = FakePageRepository(
      pages: [
        PublishedPage(
          slug: '/legal/terms',
          title: 'Terms of service',
          contentMarkdown: [
            '## Using the site',
            '',
            'Read the [privacy policy](/privacy) and the',
            '[series](/series/$seriesId) as often as you like.',
          ].join('\n'),
        ),
        const PublishedPage(
          slug: '/privacy',
          title: 'Privacy policy',
          contentMarkdown: 'How we keep your data.',
        ),
        const PublishedPage(
          slug: '/blank',
          title: 'Blank',
          contentMarkdown: '',
        ),
      ],
    );
    browser = FakeExternalBrowser();
  });

  Future<void> openPage(WidgetTester tester, String slug) async {
    router = createAppRouter(
      initialLocation: AppRoutes.publishedPagePath(slug),
    );
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: fakeAuthController(),
        pages: pages,
        site: const PublicSite(host: 'shop.example'),
        browser: browser,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// Follows [href] the way a tap on a link in the body does.
  void tapLink(WidgetTester tester, String href) {
    tester
        .widget<MarkdownBody>(find.byKey(const ValueKey('page-body')))
        .onTapLink!('link', href, '');
  }

  testWidgets('sets the page title and its Markdown body', (tester) async {
    await openPage(tester, '/legal/terms');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

    expect(pages.reads, ['/legal/terms']);
    expect(find.text('Terms of service'), findsOneWidget);
    expect(find.text('Using the site'), findsOneWidget);
  });

  testWidgets('says the page has no text yet when its body is empty', (
    tester,
  ) async {
    await openPage(tester, '/blank');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-body-empty')));

    expect(find.text('This page has no content yet.'), findsOneWidget);
  });

  testWidgets('says so when no page is published at the slug', (tester) async {
    await openPage(tester, '/gone');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-not-found')));

    expect(find.text('This page is no longer available.'), findsOneWidget);
  });

  testWidgets('offers a retry when the page could not be read', (tester) async {
    pages.getFailure = const PageFailure(PageFailureKind.network);
    await openPage(tester, '/privacy');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-retry')));

    pages.getFailure = null;
    await tester.tap(find.byKey(const ValueKey('page-retry')));
    await pumpUntilFound(tester, find.text('How we keep your data.'));
  });

  group('a link in the body', () {
    testWidgets('opens a screen of the app in the app', (tester) async {
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      tapLink(tester, '/series/$seriesId');
      await tester.pump();

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
      expect(browser.opened, isEmpty);
    });

    testWidgets('opens another published page in the app', (tester) async {
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      tapLink(tester, 'https://shop.example/en/privacy');
      await pumpUntilFound(tester, find.text('How we keep your data.'));

      expect(router.state.uri.path, AppRoutes.publishedPagePath('/privacy'));
      expect(browser.opened, isEmpty);
    });

    testWidgets('hands another site to the browser', (tester) async {
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      tapLink(tester, 'https://elsewhere.example/cookies');
      await tester.pump();

      expect(browser.opened, [Uri.parse('https://elsewhere.example/cookies')]);
    });

    testWidgets('goes nowhere when it names no page the app may open', (
      tester,
    ) async {
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      for (final href in [
        'javascript:alert(1)',
        'file:///etc/hosts',
        '//evil.example/path',
        'intent://scan#Intent;end',
      ]) {
        tapLink(tester, href);
        await tester.pump();
      }

      expect(browser.opened, isEmpty);
      expect(
        router.state.uri.path,
        AppRoutes.publishedPagePath('/legal/terms'),
      );
    });
  });

  testWidgets('fetches an image only from an https address', (tester) async {
    pages.pages = const [
      PublishedPage(
        slug: '/images',
        title: 'Images',
        contentMarkdown:
            '![local](file:///etc/hosts)\n\n![asset](resource:icon.png)',
      ),
    ];
    await openPage(tester, '/images');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

    expect(find.byType(Image), findsNothing);
    expect(find.text('local'), findsOneWidget);
    expect(find.text('asset'), findsOneWidget);
  });
}
