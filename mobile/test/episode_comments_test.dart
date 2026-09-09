import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/app.dart';
import 'package:publira/auth/auth_session.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/models/episode_comment.dart';
import 'package:publira/router.dart';

import 'support/fake_auth.dart';
import 'support/fake_catalog_repository.dart';
import 'support/fake_comment_repository.dart';
import 'support/pump_until.dart';

void main() {
  final seriesId = fixtureSeries.first.id;
  final episodeId = '$seriesId-ep-1';
  final commentsPath = AppRoutes.episodeCommentsPath(seriesId, episodeId);

  /// A comment somebody other than the signed-in reader wrote.
  EpisodeComment otherReader({
    String id = 'comment-other',
    String body = 'A stranger read this too.',
    int minute = 30,
  }) {
    return EpisodeComment(
      id: id,
      body: body,
      createdAt: DateTime.utc(2026, 9, 8, 10, minute),
      authorId: 'SeedMMBRBBB2',
      authorName: 'Another Member',
    );
  }

  /// A published comment of the reader the tests sign in as.
  EpisodeComment ownPublished({String id = 'comment-mine'}) {
    return EpisodeComment(
      id: id,
      body: 'I wrote this one.',
      createdAt: DateTime.utc(2026, 9, 8, 11),
      authorId: fakeSession.userPublicId,
      authorName: fakeSession.userName,
    );
  }

  final submit = find.byKey(const ValueKey('comment-submit'));
  final formMessage = find.byKey(const ValueKey('comment-form-message'));

  late FakeCatalogRepository catalog;
  late FakeCommentRepository comments;

  setUp(() {
    catalog = FakeCatalogRepository(
      series: fixtureSeries,
      details: fixtureDetails(),
      episodes: fixtureEpisodes(),
    );
    comments = FakeCommentRepository();
  });

  Future<void> pumpComments(WidgetTester tester, {AuthSession? session}) async {
    await tester.pumpWidget(
      PubliraApp(
        router: createAppRouter(initialLocation: commentsPath),
        catalog: catalog,
        auth: fakeAuthController(session: session),
        comments: comments,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('the published comments of an episode are listed', (
    tester,
  ) async {
    comments.pages = {
      '': EpisodeCommentPage(comments: [otherReader()]),
    };
    await pumpComments(tester);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('comment-tile-comment-other')),
    );
    expect(find.text('A stranger read this too.'), findsOneWidget);
    expect(find.text('Another Member'), findsOneWidget);
  });

  testWidgets('an episode nobody has commented on says so', (tester) async {
    await pumpComments(tester);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-empty')),
    );
    expect(find.text('No comments yet.'), findsOneWidget);
  });

  testWidgets('a reader who is signed out is offered the way in', (
    tester,
  ) async {
    await pumpComments(tester);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-sign-in')),
    );
    expect(find.text('Sign in to leave a comment.'), findsOneWidget);
    expect(find.byKey(const ValueKey('comment-body')), findsNothing);
  });

  testWidgets('a signed-in reader posts a comment and reads it back', (
    tester,
  ) async {
    await pumpComments(tester, session: fakeSession);
    await pumpUntilRouteSettled(tester, submit);

    await tester.enterText(
      find.byKey(const ValueKey('comment-body')),
      'What an episode.',
    );
    await tester.tap(submit);
    await pumpUntilFound(tester, formMessage);

    expect(comments.posted, ['What an episode.']);
    expect(find.text('Your comment has been posted.'), findsOneWidget);
    await pumpUntilFound(tester, find.text('What an episode.'));
  });

  testWidgets('an empty comment is refused before it is sent', (tester) async {
    await pumpComments(tester, session: fakeSession);
    await pumpUntilRouteSettled(tester, submit);

    await tester.tap(submit);
    await pumpUntilFound(tester, formMessage);

    expect(find.text('Write something before posting.'), findsOneWidget);
    expect(comments.posted, isEmpty);
  });

  testWidgets(
    'a comment written without a connection fails rather than waits',
    (tester) async {
      comments.postFailure = const CommentFailure(CommentFailureKind.network);
      await pumpComments(tester, session: fakeSession);
      await pumpUntilRouteSettled(tester, submit);

      await tester.enterText(
        find.byKey(const ValueKey('comment-body')),
        'Posted from a tunnel.',
      );
      await tester.tap(submit);
      await pumpUntilFound(tester, formMessage);

      expect(
        find.text('Could not connect to the server. Please try again later.'),
        findsOneWidget,
      );
      // Nothing is queued: the box still holds what the reader wrote, for them
      // to send again once they are back.
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('comment-body')))
            .controller
            ?.text,
        'Posted from a tunnel.',
      );
    },
  );

  testWidgets('comments that cannot be reached offer a retry', (tester) async {
    comments.listFailure = const CommentFailure(CommentFailureKind.network);
    await pumpComments(tester);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-error')),
    );
    expect(
      find.text('Could not connect to the server. Please try again later.'),
      findsOneWidget,
    );

    comments
      ..listFailure = null
      ..pages = {
        '': EpisodeCommentPage(comments: [otherReader()]),
      };
    await tester.tap(find.text('Retry'));
    await pumpUntilFound(tester, find.text('A stranger read this too.'));
  });

  testWidgets('a tenant that approves comments says so, and marks the wait', (
    tester,
  ) async {
    comments
      ..mode = CommentMode.approvalRequired
      ..own = [
        EpisodeComment(
          id: 'comment-pending',
          body: 'Still waiting.',
          createdAt: DateTime.utc(2026, 9, 8, 12),
          awaitingApproval: true,
        ),
      ];
    await pumpComments(tester, session: fakeSession);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-approval-notice')),
    );
    expect(find.text('Awaiting approval'), findsOneWidget);
    expect(find.text('Still waiting.'), findsOneWidget);
    // The row is the reader's own, so it carries the name the API leaves out.
    expect(find.text(fakeSession.userName), findsOneWidget);
  });

  testWidgets('a reader takes their own comment down', (tester) async {
    comments.pages = {
      '': EpisodeCommentPage(comments: [ownPublished(), otherReader()]),
    };
    await pumpComments(tester, session: fakeSession);

    final delete = find.byKey(const ValueKey('comment-delete-comment-mine'));
    await pumpUntilRouteSettled(tester, delete);
    await tester.tap(delete);
    await pumpUntilTrue(
      tester,
      () => comments.withdrawn.isNotEmpty,
      description: 'the comment to be withdrawn',
    );

    expect(comments.withdrawn, ['comment-mine']);
    await pumpUntilTrue(
      tester,
      () => find.text('I wrote this one.').evaluate().isEmpty,
      description: 'the row to leave the list',
    );
  });

  testWidgets('a reader reports somebody else with a reason', (tester) async {
    comments.pages = {
      '': EpisodeCommentPage(comments: [otherReader()]),
    };
    await pumpComments(tester, session: fakeSession);

    final report = find.byKey(const ValueKey('comment-report-comment-other'));
    await pumpUntilRouteSettled(tester, report);
    await tester.tap(report);
    await pumpUntilRouteSettled(
      tester,
      find.byKey(const ValueKey('comment-report-dialog')),
    );

    await tester.tap(
      find.byKey(const ValueKey('comment-report-reason-spoiler')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('comment-report-note')),
      'It gives the ending away.',
    );
    await tester.tap(find.byKey(const ValueKey('comment-report-confirm')));
    await pumpUntilFound(
      tester,
      find.text('Thank you. Your report has been sent to the moderators.'),
    );

    final sent = comments.reports.single;
    expect(sent.commentPublicId, 'comment-other');
    expect(sent.reason, CommentReportReason.spoiler);
    expect(sent.note, 'It gives the ending away.');
  });

  testWidgets('a reader cannot report their own comment', (tester) async {
    comments.pages = {
      '': EpisodeCommentPage(comments: [ownPublished()]),
    };
    await pumpComments(tester, session: fakeSession);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('comment-delete-comment-mine')),
    );
    expect(
      find.byKey(const ValueKey('comment-report-comment-mine')),
      findsNothing,
    );
  });

  testWidgets('the older comments are asked for with the cursor the API gave', (
    tester,
  ) async {
    comments.pages = {
      '': EpisodeCommentPage(
        comments: [otherReader(body: 'The newest one.')],
        nextToken: 'older-token',
      ),
      'older-token': EpisodeCommentPage(
        comments: [
          otherReader(id: 'comment-older', body: 'An older one.', minute: 5),
        ],
        previousToken: 'newer-token',
      ),
    };
    await pumpComments(tester);

    final older = find.byKey(const ValueKey('comment-older-page'));
    await pumpUntilRouteSettled(tester, older);
    await tester.tap(older);
    await pumpUntilFound(tester, find.text('An older one.'));

    expect(comments.tokens, ['', 'older-token']);
  });

  testWidgets('a tenant that takes no comments shows none', (tester) async {
    comments
      ..mode = CommentMode.disabled
      ..pages = {
        '': EpisodeCommentPage(comments: [otherReader()]),
      };
    await pumpComments(tester);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-disabled')),
    );
    expect(find.text('A stranger read this too.'), findsNothing);
  });

  testWidgets('the reader keeps the list when their own comments fail', (
    tester,
  ) async {
    comments
      ..ownFailure = const CommentFailure(CommentFailureKind.unexpected)
      ..pages = {
        '': EpisodeCommentPage(comments: [otherReader()]),
      };
    await pumpComments(tester, session: fakeSession);

    await pumpUntilFound(
      tester,
      find.byKey(const ValueKey('episode-comments-own-error')),
    );
    expect(find.text('A stranger read this too.'), findsOneWidget);
  });
}
