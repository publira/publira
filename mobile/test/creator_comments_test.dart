import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/models/episode_comment.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_comment_repository.dart';
import 'support/fake_creator_repository.dart';
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

  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';

  MyCreatorEpisodeComment row(
    String id, {
    required String body,
    required int day,
    String authorName = 'Another Member',
    String creatorName = '',
    String episodeTitle = 'The Harbor',
  }) => MyCreatorEpisodeComment(
    comment: EpisodeComment(
      id: id,
      body: body,
      createdAt: DateTime.utc(2026, 10, day, 9),
      authorId: 'MEMBER-$id',
      authorName: authorName,
      creatorName: creatorName,
    ),
    seriesPublicId: seriesId,
    seriesTitle: 'Night Ferry',
    episodePublicId: episodeId,
    episodeTitle: episodeTitle,
  );

  final own = row(
    'comment-own',
    body: 'Thank you for reading to the end.',
    day: 12,
    authorName: 'Creator Reader',
    creatorName: 'Mina Harbor',
    episodeTitle: 'The Lighthouse',
  );
  final reader = row(
    'comment-reader',
    body: 'The first page already had me hooked.',
    day: 10,
  );

  final ownRow = find.byKey(const ValueKey('creator-comments-row-comment-own'));
  final readerRow = find.byKey(
    const ValueKey('creator-comments-row-comment-reader'),
  );
  final creatorBadge = find.byKey(const ValueKey('comment-creator-badge'));

  late FakeCreatorRepository creators;
  late FakeCommentRepository comments;

  setUp(() {
    creators = FakeCreatorRepository(
      creators: const MyCreators(creators: [harbor, ferry]),
      comments: {
        harbor.id: [own, reader],
      },
    );
    comments = FakeCommentRepository(
      pages: {
        '': EpisodeCommentPage(comments: [own.comment]),
      },
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
        catalog: FakeCatalogRepository(
          series: fixtureSeries,
          details: fixtureDetails(),
          episodes: fixtureEpisodes(),
        ),
        auth: fakeAuthController(session: fakeSession),
        creators: creators,
        comments: comments,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets("the Author's page leads to the comments on their episodes", (
    tester,
  ) async {
    await pumpApp(tester, AppRoutes.accountCreatorPagePath(harbor.id));
    final entry = find.byKey(ValueKey('creator-pages-comments-${harbor.id}'));
    await pumpUntilFound(tester, entry);

    await tester.tap(entry);
    await pumpUntilRouteSettled(tester, ownRow);

    expect(find.byKey(const ValueKey('creator-comments-reply-hint')), findsOne);
  });

  testWidgets('the comments read newest first, the Author\'s own badged', (
    tester,
  ) async {
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath(harbor.id));
    await pumpUntilFound(tester, ownRow);

    expect(find.text('Mina Harbor'), findsWidgets);
    expect(
      tester.getTopLeft(ownRow).dy,
      lessThan(tester.getTopLeft(readerRow).dy),
    );
    expect(
      find.descendant(of: ownRow, matching: find.text('The Lighthouse')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: ownRow, matching: find.text('Night Ferry')),
      findsOneWidget,
    );
    expect(find.descendant(of: ownRow, matching: creatorBadge), findsOneWidget);
    expect(
      find.descendant(of: readerRow, matching: creatorBadge),
      findsNothing,
    );
    expect(
      find.descendant(of: readerRow, matching: find.text('Another Member')),
      findsOneWidget,
    );
    // Read-only: nothing on a row acts on the comment.
    expect(find.byType(TextButton), findsNothing);
  });

  testWidgets("a row opens its episode's comments", (tester) async {
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath(harbor.id));
    await pumpUntilFound(tester, ownRow);

    await tester.tap(ownRow);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('comment-tile-comment-own')),
    );

    expect(comments.episodeIds, [fixtureInternalId(episodeId)]);
  });

  testWidgets('an Author nobody has commented on says so', (tester) async {
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath(ferry.id));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('creator-comments-empty')),
    );

    expect(
      find.text("Nobody has commented on this author's episodes yet."),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('comment-older-page')), findsNothing);
  });

  testWidgets('pages to the older comments and back', (tester) async {
    creators.pageSize = 1;
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath(harbor.id));
    await pumpUntilFound(tester, ownRow);
    expect(readerRow, findsNothing);

    await tester.tap(find.byKey(const ValueKey('comment-older-page')));
    await pumpUntilFound(tester, readerRow);
    expect(ownRow, findsNothing);

    await tester.tap(find.byKey(const ValueKey('comment-newer-page')));
    await pumpUntilFound(tester, ownRow);
    expect(readerRow, findsNothing);
  });

  testWidgets('an Author the account is not linked to shows no list', (
    tester,
  ) async {
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath('elsewhere'));
    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('creator-comments-error')),
    );

    expect(find.text('This author page is not available.'), findsOneWidget);
  });

  testWidgets('a list that cannot be read offers a retry', (tester) async {
    creators.commentsFailure = const CreatorFailure(
      CreatorFailureKind.unexpected,
    );
    await pumpApp(tester, AppRoutes.accountCreatorCommentsPath(harbor.id));
    final retry = find.byKey(const ValueKey('creator-comments-retry'));
    await pumpUntilFound(tester, retry);
    expect(find.text('Could not show the comments. Try again.'), findsOne);

    creators.commentsFailure = null;
    await tester.tap(retry);
    await pumpUntilFound(tester, ownRow);
  });
}
