import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/follow/follow_control.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/localizations.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_follow_repository.dart';
import 'support/pump_until.dart';

void main() {
  final series = fixtureSeries.first;
  final creator = fixtureCreators.first;

  late GoRouter router;
  late FakeCatalogRepository catalog;
  late FakeFollowRepository follows;

  setUp(() {
    router = createAppRouter();
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      creators: fixtureCreators,
    );
    follows = FakeFollowRepository();
  });

  /// The app as [session] holds it, with the follow repository installed
  /// unless [withFollows] takes it away.
  Future<void> pumpApp(
    WidgetTester tester, {
    AuthSession? session,
    bool withFollows = true,
  }) async {
    // The series screen is taller than the default test surface, and a lazy
    // list does not build what no viewport reaches: the authors and the
    // episodes under them would never be laid out.
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      PubliraApp(
        router: router,
        catalog: catalog,
        auth: fakeAuthController(session: session),
        follows: withFollows ? follows : null,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  /// The series screen of the fixture series, open and settled.
  Future<void> openSeries(
    WidgetTester tester, {
    AuthSession? session,
    bool withFollows = true,
  }) async {
    router = createAppRouter(
      initialLocation: AppRoutes.seriesDetailPath(series.id),
    );
    await pumpApp(tester, session: session, withFollows: withFollows);
    await pumpUntilRouteSettled(tester, find.text('Episodes'));
  }

  /// The list of what the reader follows, open and settled.
  Future<void> openFollows(
    WidgetTester tester, {
    AuthSession? session = fakeSession,
    bool withFollows = true,
  }) async {
    router = createAppRouter(initialLocation: AppRoutes.accountFollows);
    await pumpApp(tester, session: session, withFollows: withFollows);
    await pumpUntilRouteSettled(tester, find.text('Follows'));
  }

  group('the control on a series screen', () {
    testWidgets('offers the series and each of its authors', (tester) async {
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.byKey(ValueKey('follow-${series.id}')));

      expect(find.text('Authors'), findsOneWidget);
      for (final credit in fixtureCreators) {
        expect(find.byKey(ValueKey('series-creator-${credit.id}')), findsOne);
        expect(find.byKey(ValueKey('follow-${credit.id}')), findsOne);
      }
    });

    testWidgets('sends a reader who is signed out to sign in', (tester) async {
      await openSeries(tester);

      expect(find.byKey(ValueKey('follow-${series.id}')), findsNothing);
      await tester.tap(find.byKey(ValueKey('follow-sign-in-${series.id}')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

      expect(router.state.uri.path, AppRoutes.signIn);
      expect(follows.statusReads, 0);
    });

    testWidgets('follows the series and then stops following it', (
      tester,
    ) async {
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.byKey(ValueKey('follow-${series.id}')));

      await tester.tap(find.byKey(ValueKey('follow-${series.id}')));
      await pumpUntilFound(tester, find.text('Unfollow'));

      expect(follows.followed, ['series:${series.id}']);

      await tester.tap(find.byKey(ValueKey('follow-${series.id}')));
      await pumpUntilFound(tester, find.text('Follow'));

      expect(follows.unfollowed, ['series:${series.id}']);
    });

    testWidgets('opens on the state the API already holds', (tester) async {
      follows.following.add('creator:${creator.id}');
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.text('Unfollow'));

      final button = find.descendant(
        of: find.byKey(ValueKey('series-creator-${creator.id}')),
        matching: find.text('Unfollow'),
      );
      expect(button, findsOne);
    });

    testWidgets('says why a follow the reader asked for did not happen', (
      tester,
    ) async {
      follows.writeFailure = const FollowFailure(FollowFailureKind.network);
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.byKey(ValueKey('follow-${series.id}')));

      await tester.tap(find.byKey(ValueKey('follow-${series.id}')));
      await pumpUntilFound(
        tester,
        find.byKey(const ValueKey('follow-failure')),
      );

      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOne,
      );
      expect(find.text('Follow'), findsWidgets);
    });

    testWidgets('offers to follow when the state could not be read', (
      tester,
    ) async {
      follows.statusFailure = const FollowFailure(FollowFailureKind.network);
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.byKey(ValueKey('follow-${series.id}')));

      await tester.tap(find.byKey(ValueKey('follow-${series.id}')));
      await pumpUntilFound(tester, find.text('Unfollow'));

      expect(follows.followed, ['series:${series.id}']);
    });

    testWidgets('names the target it acts on, and can be activated by name', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      await openSeries(tester, session: fakeSession);
      await pumpUntilFound(tester, find.byKey(ValueKey('follow-${series.id}')));

      final node = tester.getSemantics(
        find.byKey(ValueKey('follow-${creator.id}')),
      );
      expect(node.label, 'Follow ${creator.name}');

      // Activating it the way assistive technology does is what proves the
      // control kept the tap action: naming the target excludes the button's
      // own semantics, and its action would go with them.
      tester.semantics.tap(find.semantics.byLabel('Follow ${creator.name}'));
      await pumpUntilTrue(
        tester,
        () => follows.followed.isNotEmpty,
        description: 'the follow the semantics action asked for',
      );

      expect(follows.followed, ['creator:${creator.id}']);
      semantics.dispose();
    });

    testWidgets('reads again when its row is recycled onto another target', (
      tester,
    ) async {
      final auth = fakeAuthController(session: fakeSession);
      follows.following.add(
        FakeFollowRepository.targetKey(
          FollowTargetKind.creator,
          fixtureCreators.first.id,
        ),
      );

      Future<void> pumpControl(SeriesCreator target) async {
        await tester.pumpWidget(
          AuthScope(
            controller: auth,
            child: FollowScope(
              repository: follows,
              child: MaterialApp(
                localizationsDelegates: appLocalizationsDelegates,
                supportedLocales: AppMessages.supportedLocales,
                home: Scaffold(
                  body: FollowControl(
                    kind: FollowTargetKind.creator,
                    targetId: target.id,
                    targetName: target.name,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pump();
      }

      await pumpControl(fixtureCreators.first);
      await pumpUntilFound(tester, find.text('Unfollow'));

      // The same control, rebuilt against an author nothing follows: keeping
      // the state of the one before it would offer to unfollow a stranger.
      await pumpControl(fixtureCreators.last);
      await pumpUntilFound(tester, find.text('Follow'));

      expect(follows.statusReads, 2);
    });

    testWidgets('is left out of a build that follows nothing', (tester) async {
      await openSeries(tester, withFollows: false);

      expect(find.byKey(ValueKey('follow-${series.id}')), findsNothing);
      expect(find.byKey(ValueKey('follow-sign-in-${series.id}')), findsNothing);
      expect(find.text('Authors'), findsNothing);
    });
  });

  group('the list of what a reader follows', () {
    testWidgets('is reached from the account screen', (tester) async {
      router = createAppRouter(initialLocation: AppRoutes.account);
      await pumpApp(tester, session: fakeSession);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('account-follows')),
      );

      await tester.tap(find.byKey(const ValueKey('account-follows')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('follows-empty')));

      expect(router.state.uri.path, AppRoutes.accountFollows);
    });

    testWidgets('names each row from the catalog', (tester) async {
      follows.pages = [
        [
          MyFollow(
            kind: FollowTargetKind.series,
            targetId: series.id,
            followedAt: DateTime.utc(2026, 9, 8, 10, 30),
          ),
          MyFollow(kind: FollowTargetKind.creator, targetId: creator.id),
        ],
      ];
      await openFollows(tester);
      await pumpUntilFound(tester, find.text(series.title));

      expect(find.text(creator.name), findsOne);
      expect(
        find.descendant(
          of: find.byKey(ValueKey('follow-row-${creator.id}')),
          matching: find.text('Author'),
        ),
        findsOne,
      );
      expect(
        find.descendant(
          of: find.byKey(ValueKey('follow-row-${series.id}')),
          matching: find.textContaining('Series · Followed '),
        ),
        findsOne,
      );
    });

    testWidgets('opens the series a row stands for', (tester) async {
      follows.pages = [
        [MyFollow(kind: FollowTargetKind.series, targetId: series.id)],
      ];
      await openFollows(tester);
      await pumpUntilRouteSettled(tester, find.text(series.title));

      await tester.tap(find.byKey(ValueKey('follow-row-${series.id}')));
      await pumpUntilFound(tester, find.text('Episodes'));

      expect(router.state.uri.path, AppRoutes.seriesDetailPath(series.id));
    });

    testWidgets('offers to unfollow without asking for the state', (
      tester,
    ) async {
      follows.pages = [
        [MyFollow(kind: FollowTargetKind.creator, targetId: creator.id)],
      ];
      await openFollows(tester);
      await pumpUntilFound(tester, find.text('Unfollow'));

      expect(follows.statusReads, 0);

      await tester.tap(find.byKey(ValueKey('follow-${creator.id}')));
      await pumpUntilFound(tester, find.text('Follow'));

      expect(follows.unfollowed, ['creator:${creator.id}']);
    });

    testWidgets('reads the page under it as the reader nears the end', (
      tester,
    ) async {
      follows.pages = [
        [
          for (var index = 0; index < 20; index++)
            MyFollow(
              kind: FollowTargetKind.creator,
              targetId: 'SeedAUTHPAGE$index',
            ),
        ],
        [MyFollow(kind: FollowTargetKind.series, targetId: series.id)],
      ];
      await openFollows(tester);
      await pumpUntilFound(tester, find.byKey(const ValueKey('follows-list')));

      await tester.fling(
        find.byKey(const ValueKey('follows-list')),
        const Offset(0, -2000),
        1000,
      );
      await pumpUntilFound(tester, find.text(series.title));

      expect(find.byKey(ValueKey('follow-row-${series.id}')), findsOne);
    });

    testWidgets('tells a reader who follows nothing so', (tester) async {
      await openFollows(tester);
      await pumpUntilFound(tester, find.byKey(const ValueKey('follows-empty')));

      expect(find.byKey(const ValueKey('follows-list')), findsNothing);
    });

    testWidgets('offers a retry after a page it could not read', (
      tester,
    ) async {
      follows
        ..pages = [
          [MyFollow(kind: FollowTargetKind.series, targetId: series.id)],
        ]
        ..listFailure = const FollowFailure(FollowFailureKind.network);
      await openFollows(tester);
      await pumpUntilFound(tester, find.byKey(const ValueKey('follows-error')));

      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOne,
      );

      follows.listFailure = null;
      await tester.tap(find.byKey(const ValueKey('follows-retry')));
      await pumpUntilFound(tester, find.text(series.title));
    });

    testWidgets('asks a reader who is signed out to sign in', (tester) async {
      await openFollows(tester, session: null);
      await pumpUntilRouteSettled(
        tester,
        find.byKey(const ValueKey('follows-signed-out')),
      );

      await tester.tap(find.byKey(const ValueKey('follows-sign-in')));
      await pumpUntilFound(tester, find.byKey(const ValueKey('sign-in-email')));

      expect(router.state.uri.path, AppRoutes.signIn);
    });
  });
}
