import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/app.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_statement_csv.dart';
import 'package:publira/links/app_link.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_creator_repository.dart';
import 'support/fake_links.dart';
import 'support/pump_until.dart';

void main() {
  const harbor = MyCreator(
    id: 'creator-harbor',
    publicId: 'AUTHOR000001',
    name: 'Mina Harbor',
  );
  const ferry = MyCreator(
    id: 'creator-ferry',
    publicId: 'AUTHOR000002',
    name: 'Jun Ferry',
  );

  MyCreatorStats stats({
    required int followers,
    List<MyCreatorEpisodeStats> episodes = const [],
  }) => MyCreatorStats(
    periodStart: DateTime(2026, 10, 4),
    periodEnd: DateTime(2026, 10, 31),
    timeZone: 'Asia/Tokyo',
    followerCount: followers,
    totalMemberViewCount: episodes.fold(
      0,
      (sum, episode) => sum + episode.memberViewCount,
    ),
    totalCompleteCount: episodes.fold(
      0,
      (sum, episode) => sum + episode.completeCount,
    ),
    currency: 'JPY',
    episodes: episodes,
  );

  MyCreatorEpisodeStats episode(
    String id, {
    required int views,
    required int completes,
    bool sales = true,
  }) => MyCreatorEpisodeStats(
    seriesPublicId: 'SERIES000001',
    seriesTitle: 'Night Ferry',
    episodePublicId: id,
    episodeTitle: 'Episode $id',
    memberViewCount: views,
    completeCount: completes,
    purchaseCount: sales ? 3 : null,
    netAmount: sales ? 1500 : null,
  );

  final december = MyCreatorStatement(
    period: '2025-12',
    timeZone: 'UTC',
    closedAt: DateTime.utc(2026, 1, 5, 10),
    currency: 'JPY',
    saleCount: 8,
    grossAmount: 4000,
    refundedAmount: 0,
    payoutAmount: 1200,
  );

  MyCreatorStatementLine line({
    int lineNumber = 1,
    String roleName = 'Artist',
    int saleCount = 8,
    int grossAmount = 4000,
    int refundedAmount = 0,
    int shareBps = 3000,
    int payoutAmount = 1200,
    String adjustedPeriod = '',
    CreatorStatementLineSource source = CreatorStatementLineSource.sale,
    String seriesTitle = 'Night Ferry',
    String episodeTitle = 'The Harbor',
  }) => MyCreatorStatementLine(
    lineNumber: lineNumber,
    seriesPublicId: 'SERIES000001',
    seriesTitle: seriesTitle,
    episodePublicId: 'EPISODE00001',
    episodeTitle: episodeTitle,
    roleName: roleName,
    saleCount: saleCount,
    grossAmount: grossAmount,
    refundedAmount: refundedAmount,
    shareBps: shareBps,
    payoutAmount: payoutAmount,
    adjustedPeriod: adjustedPeriod,
    source: source,
  );

  final decemberLines = [
    line(),
    line(
      lineNumber: 3,
      roleName: '',
      shareBps: 1250,
      source: CreatorStatementLineSource.subscription,
    ),
    line(
      lineNumber: 5,
      saleCount: 2,
      grossAmount: 600,
      payoutAmount: 180,
      source: CreatorStatementLineSource.tip,
    ),
    line(
      lineNumber: 7,
      saleCount: -1,
      grossAmount: -500,
      refundedAmount: -500,
      payoutAmount: -150,
      adjustedPeriod: '2025-11',
    ),
    line(
      lineNumber: 9,
      saleCount: -1,
      grossAmount: -300,
      refundedAmount: -300,
      payoutAmount: -90,
      adjustedPeriod: '2025-11',
      source: CreatorStatementLineSource.tip,
    ),
  ];

  const header =
      'period,role_name,series_id,series_title,episode_id,episode_title,'
      'sale_count,gross_amount,refunded_amount,share_percent,payout_amount,'
      'currency,adjusted_period,source';

  final entry = find.byKey(const ValueKey('account-creator-pages'));

  late FakeCreatorRepository creators;
  late FakeShareSheet share;

  setUp(() {
    share = FakeShareSheet();
    creators = FakeCreatorRepository(
      creators: const MyCreators(creators: [harbor], salesVisible: true),
      figures: {
        harbor.id: stats(
          followers: 1234,
          episodes: [
            episode('EPISODE00001', views: 30, completes: 9),
            episode('EPISODE00002', views: 0, completes: 0),
          ],
        ),
        ferry.id: stats(
          followers: 56,
          episodes: [episode('EPISODE00003', views: 4, completes: 1)],
        ),
      },
      statements: {
        harbor.id: [december],
      },
      lines: {(harbor.id, '2025-12'): decemberLines},
    );
  });

  Future<void> pumpApp(WidgetTester tester, String initialLocation) async {
    tester.view
      ..physicalSize = const Size(1000, 2400)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: initialLocation),
        catalog: FakeCatalogRepository(),
        auth: fakeAuthController(session: fakeSession),
        creators: creators,
        site: const PublicSite(host: 'localhost'),
        share: share,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// The account screen once every row it reads has answered.
  Future<void> pumpAccount(WidgetTester tester) async {
    await pumpApp(tester, AppRoutes.account);
    await pumpUntilFound(tester, find.byKey(const ValueKey('account-list')));
    await tester.pumpAndSettle();
  }

  String textIn(Finder finder) => find
      .descendant(of: finder, matching: find.byType(RichText))
      .evaluate()
      .map((element) => (element.widget as RichText).text.toPlainText())
      .join(' ');

  group('the account screen', () {
    testWidgets('leads a reader linked to an Author to their pages', (
      tester,
    ) async {
      await pumpAccount(tester);

      expect(entry, findsOneWidget);
      expect(find.text('Your author pages'), findsOneWidget);

      await tester.tap(entry);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-stats')),
      );

      expect(find.text('Mina Harbor'), findsOneWidget);
    });

    testWidgets('offers nothing to an account linked to no Author', (
      tester,
    ) async {
      creators.creators = MyCreators.none;
      await pumpAccount(tester);

      expect(creators.calls, ['pagesEnabled', 'listMyCreators']);
      expect(entry, findsNothing);
    });

    testWidgets('asks nothing of a tenant with the pages off', (tester) async {
      creators.enabled = false;
      await pumpAccount(tester);

      expect(creators.calls, ['pagesEnabled']);
      expect(entry, findsNothing);
    });

    testWidgets('leaves the row out when the Authors cannot be read', (
      tester,
    ) async {
      creators.failure = const CreatorFailure(CreatorFailureKind.network);
      await pumpAccount(tester);

      expect(entry, findsNothing);
    });
  });

  group("an Author's page", () {
    testWidgets('shows the window, the figures, and every episode', (
      tester,
    ) async {
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-statement-2025-12')),
      );

      expect(
        find.text(
          'Oct 4, 2026 - Oct 31, 2026, counted in calendar days in '
          'Asia/Tokyo.',
        ),
        findsOneWidget,
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-pages-followers'))),
        'Followers 1,234',
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-pages-member-views'))),
        'Member views 30',
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-pages-completions'))),
        'Completions 9',
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-pages-read-through-rate'))),
        'Read-through rate 30%',
      );

      expect(
        textIn(
          find.byKey(const ValueKey('creator-pages-episode-rate-EPISODE00001')),
        ),
        'Read-through rate 30%',
      );
      // A rate over no views is not zero.
      expect(
        textIn(
          find.byKey(const ValueKey('creator-pages-episode-rate-EPISODE00002')),
        ),
        'Read-through rate —',
      );
      expect(
        textIn(
          find.byKey(
            const ValueKey('creator-pages-episode-sales-EPISODE00001'),
          ),
        ),
        'Sales 3',
      );
      expect(
        textIn(
          find.byKey(const ValueKey('creator-pages-episode-net-EPISODE00001')),
        ),
        'Net amount ¥1,500',
      );

      expect(find.text('Closed statements'), findsOneWidget);
      expect(find.text('December 2025'), findsOneWidget);
      expect(
        textIn(
          find.byKey(const ValueKey('creator-pages-statement-payout-2025-12')),
        ),
        'Payout ¥1,200',
      );
    });

    testWidgets('shows no amount and no statement while sales are hidden', (
      tester,
    ) async {
      creators
        ..creators = const MyCreators(creators: [harbor])
        ..figures[harbor.id] = stats(
          followers: 1234,
          episodes: [
            episode('EPISODE00001', views: 30, completes: 9, sales: false),
          ],
        );
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-stats')),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00001')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('creator-pages-episode-sales-EPISODE00001')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('creator-pages-episode-net-EPISODE00001')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('creator-pages-statements')),
        findsNothing,
      );
      expect(find.text('Closed statements'), findsNothing);
      expect(creators.calls, isNot(contains('listStatements')));
    });

    testWidgets('switches between the Authors with tabs', (tester) async {
      creators.creators = const MyCreators(
        creators: [harbor, ferry],
        salesVisible: true,
      );
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-stats')),
      );
      await tester.pumpAndSettle();

      expect(
        textIn(find.byKey(const ValueKey('creator-pages-followers'))),
        'Followers 1,234',
      );

      await tester.tap(find.byKey(ValueKey('creator-pages-tab-${ferry.id}')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00003')),
        findsOneWidget,
      );
      expect(
        textIn(
          find.descendant(
            of: find.byKey(ValueKey('creator-pages-${ferry.id}')),
            matching: find.byKey(const ValueKey('creator-pages-followers')),
          ),
        ),
        'Followers 56',
      );
    });

    testWidgets('opens on the Author the path names', (tester) async {
      creators.creators = const MyCreators(
        creators: [harbor, ferry],
        salesVisible: true,
      );
      await pumpApp(tester, AppRoutes.accountCreatorPagePath(ferry.id));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00003')),
      );
    });

    testWidgets('says so for an Author the account is not linked to', (
      tester,
    ) async {
      await pumpApp(tester, AppRoutes.accountCreatorPagePath(ferry.id));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-not-found')),
      );
    });

    testWidgets('reads the next page of episodes when asked', (tester) async {
      creators.pageSize = 1;
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00001')),
      );
      expect(
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00002')),
        findsNothing,
      );

      final more = find.byKey(const ValueKey('creator-pages-episodes-more'));
      await tester.ensureVisible(more);
      await tester.tap(more);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-episode-EPISODE00002')),
      );
      expect(more, findsNothing);
    });

    testWidgets('keeps the figures when the statements cannot be read', (
      tester,
    ) async {
      creators.statementsFailure = const CreatorFailure(
        CreatorFailureKind.unexpected,
      );
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-statements-error')),
      );

      expect(find.byKey(const ValueKey('creator-pages-stats')), findsOneWidget);

      creators.statementsFailure = null;
      await tester.tap(
        find.byKey(const ValueKey('creator-pages-statements-retry')),
      );
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-pages-statement-2025-12')),
      );
    });
  });

  group('a closed statement', () {
    Future<void> openDecember(WidgetTester tester) async {
      await pumpApp(tester, AppRoutes.accountCreatorPages);
      final row = find.byKey(const ValueKey('creator-pages-statement-2025-12'));
      await pumpUntilFound(tester, row);
      await tester.ensureVisible(row);
      await tester.tap(row);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('creator-statement-line-7')),
      );
    }

    testWidgets('lists the lines, adjustments marked', (tester) async {
      await openDecember(tester);

      expect(find.text('December 2025 statement'), findsOneWidget);
      expect(
        find.text('Closed on Jan 5, 2026. Amounts are in JPY.'),
        findsOneWidget,
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-payout'))),
        'Payout ¥1,200',
      );
      expect(
        find.byKey(const ValueKey('creator-statement-subscription-3')),
        findsOneWidget,
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-adjustment-7'))),
        'Refund adjustment for November 2025',
      );
      expect(
        find.byKey(const ValueKey('creator-statement-adjustment-1')),
        findsNothing,
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-line-payout-7'))),
        'Payout -¥150',
      );
    });

    testWidgets('labels a tip line, and the adjustment of one, as a tip', (
      tester,
    ) async {
      await openDecember(tester);

      expect(
        find.byKey(const ValueKey('creator-statement-tip-1')),
        findsNothing,
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-tip-5'))),
        'Tip',
      );
      expect(
        find.byKey(const ValueKey('creator-statement-adjustment-5')),
        findsNothing,
      );
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('creator-statement-line-9')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-tip-9'))),
        'Tip',
      );
      expect(
        textIn(find.byKey(const ValueKey('creator-statement-adjustment-9'))),
        'Refund adjustment for November 2025',
      );
    });

    testWidgets('shares every line as the CSV the site downloads', (
      tester,
    ) async {
      creators.pageSize = 1;
      await openDecember(tester);

      await tester.tap(find.byKey(const ValueKey('creator-statement-share')));
      await pumpUntilTrue(tester, () => share.files.isNotEmpty);

      final file = share.files.single;
      expect(file.name, 'royalties-AUTHOR000001-2025-12.csv');
      expect(file.mimeType, 'text/csv');
      expect(file.title, 'December 2025 statement');
      expect(file.bytes.take(3), [0xEF, 0xBB, 0xBF]);
      expect(
        file.text,
        '$header\r\n'
        '2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,'
        '8,4000,0,30.00,1200,JPY,,sale\r\n'
        '2025-12,,SERIES000001,Night Ferry,EPISODE00001,The Harbor,'
        '8,4000,0,12.50,1200,JPY,,subscription\r\n'
        '2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,'
        '2,600,0,30.00,180,JPY,,tip\r\n'
        '2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,'
        '-1,-500,-500,30.00,-150,JPY,2025-11,sale\r\n'
        '2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,'
        '-1,-300,-300,30.00,-90,JPY,2025-11,tip\r\n',
      );
    });

    testWidgets('says so when the lines cannot be read for the CSV', (
      tester,
    ) async {
      await openDecember(tester);
      creators.failure = const CreatorFailure(CreatorFailureKind.unexpected);

      await tester.tap(find.byKey(const ValueKey('creator-statement-share')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('creator-statement-share-failed')),
      );

      expect(share.files, isEmpty);
      expect(
        find.text('Could not share the statement. Try again.'),
        findsOneWidget,
      );
    });
  });

  group('the statement CSV', () {
    test('keeps a title a spreadsheet would run as a formula as text', () {
      final csv = renderCreatorStatementCsv(december, [
        line(episodeTitle: '=HYPERLINK(1)', seriesTitle: 'A, B'),
      ]);

      expect(csv, startsWith('﻿$header\r\n'));
      expect(csv, contains('"A, B",EPISODE00001,\'=HYPERLINK(1),'));
    });

    test('is named after the Author and the month', () {
      expect(
        creatorStatementCsvName(harbor, '2025-12'),
        'royalties-AUTHOR000001-2025-12.csv',
      );
    });
  });
}
