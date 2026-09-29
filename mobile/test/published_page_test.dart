import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
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
          locale: 'en',
        ),
        const PublishedPage(
          slug: '/privacy',
          title: 'Privacy policy',
          contentMarkdown: 'How we keep your data.',
          locale: 'en',
        ),
        const PublishedPage(
          slug: '/blank',
          title: 'Blank',
          contentMarkdown: '',
          locale: 'en',
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
        .widget<MarkdownBody>(
          find.descendant(
            of: find.byKey(const ValueKey('page-body')),
            matching: find.byType(MarkdownBody),
          ),
        )
        .onTapLink!('link', href, '');
  }

  testWidgets('sets the page title and its Markdown body', (tester) async {
    await openPage(tester, '/legal/terms');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

    expect(pages.reads, ['/legal/terms']);
    expect(find.text('Terms of service'), findsOneWidget);
    expect(find.text('Using the site'), findsOneWidget);
  });

  group('in the app\'s language', () {
    testWidgets('reads the page in it', (tester) async {
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      expect(pages.readLocales, ['en']);
      expect(find.byKey(const ValueKey('page-fallback-notice')), findsNothing);
    });

    testWidgets('says which language a page without a translation in it '
        'is shown in', (tester) async {
      pages.pages = const [
        PublishedPage(
          slug: '/legal/terms',
          title: 'Terms of service',
          contentMarkdown: 'The terms you agree to.',
          locale: 'ja',
        ),
      ];
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      expect(
        find.text(
          'This page is not published in your language, so it is shown in '
          '日本語.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('reads the page again when the device changes language', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

      tester.platformDispatcher.localesTestValue = const [Locale('ko')];
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(pages.readLocales, ['en', 'ko']);
      expect(
        find.byKey(const ValueKey('page-fallback-notice')),
        findsOneWidget,
      );
    });
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
        locale: 'en',
      ),
    ];
    await openPage(tester, '/images');
    await pumpUntilFound(tester, find.byKey(const ValueKey('page-body')));

    expect(find.byType(Image), findsNothing);
    expect(find.text('local'), findsOneWidget);
    expect(find.text('asset'), findsOneWidget);
  });

  group('a Japanese page', () {
    const markdown = '利用規約はWeb版と[Summer Days](/series/SERIES)外伝に適用されます。';
    const text = '利用規約はWeb版とSummer Days外伝に適用されます。';
    final body = find.byWidgetPredicate(
      (widget) => widget is RichText && widget.text.toPlainText() == text,
    );

    Future<RenderParagraph> openJapanesePage(WidgetTester tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ja')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      pages.pages = [
        PublishedPage(
          slug: '/legal/terms',
          title: '利用規約',
          contentMarkdown: markdown.replaceFirst('SERIES', seriesId),
          locale: 'ja',
        ),
      ];
      await openPage(tester, '/legal/terms');
      await pumpUntilFound(tester, body);
      return tester.renderObject<RenderParagraph>(body);
    }

    testWidgets('spaces CJK text from a Latin word and a link', (tester) async {
      final paragraph = await openJapanesePage(tester);

      final spacing = _spacing(paragraph.text);
      final base = spacing.first.$2;
      final gap = paragraph.text.style!.fontSize! / 8;
      expect(
        [
          for (final (character, letterSpacing) in spacing)
            if (letterSpacing != base) (character, letterSpacing - base),
        ],
        [('は', gap), ('b', gap), ('と', gap), ('s', gap)],
      );
    });

    testWidgets('follows the link', (tester) async {
      final paragraph = await openJapanesePage(tester);

      final start = text.indexOf('Summer');
      final box = paragraph
          .getBoxesForSelection(
            TextSelection(baseOffset: start, extentOffset: start + 6),
          )
          .first;
      await tester.tapAt(paragraph.localToGlobal(box.toRect().center));
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('series-detail-body')),
      );

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(seriesId));
    });

    testWidgets('copies the text the Markdown holds', (tester) async {
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied =
                (call.arguments as Map<Object?, Object?>)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await openJapanesePage(tester);

      // The selection area's own focus, which takes the shortcuts.
      Focus.of(tester.element(body)).requestFocus();
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();

      expect(copied, text);
    });
  });
}

/// Every character of [span], with the letter spacing it is drawn with.
List<(String, double)> _spacing(InlineSpan span) {
  final characters = <(String, double)>[];
  void visit(InlineSpan span, double inherited) {
    if (span is! TextSpan) {
      return;
    }
    final letterSpacing = span.style?.letterSpacing ?? inherited;
    for (final character in (span.text ?? '').characters) {
      characters.add((character, letterSpacing));
    }
    for (final child in span.children ?? const <InlineSpan>[]) {
      visit(child, letterSpacing);
    }
  }

  visit(span, 0);
  return characters;
}
