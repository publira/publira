import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/http_comment_repository.dart';
import 'package:publira/models/episode_comment.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const episodeId = ConnectFixtureServer.seedEpisodeId;

  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpCommentRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpCommentRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    accessToken = '';
    server = ConnectFixtureServer(
      episodeComments: {
        episodeId: [
          {
            'publicId': 'SeedCMNTAAA1',
            'body': 'The first one.',
            'createdAt': '2026-09-08T10:30:00Z',
            'authorPublicId': 'SeedMMBRBBB2',
            'authorName': 'Another Member',
          },
        ],
      },
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('the tenant answers how it publishes comments', () async {
    server.commentMode = 'COMMENT_MODE_APPROVAL_REQUIRED';

    expect(await repository().commentMode(), CommentMode.approvalRequired);
  });

  test('a mode this build cannot name takes no comments', () async {
    server.commentMode = 'COMMENT_MODE_SOMETHING_ELSE';

    expect(await repository().commentMode(), CommentMode.disabled);
  });

  test('the published comments map onto the rows a screen renders', () async {
    final page = await repository().listComments(episodeId);

    final comment = page.comments.single;
    expect(comment.id, 'SeedCMNTAAA1');
    expect(comment.body, 'The first one.');
    expect(comment.authorId, 'SeedMMBRBBB2');
    expect(comment.authorName, 'Another Member');
    expect(comment.createdAt, DateTime.utc(2026, 9, 8, 10, 30).toLocal());
    expect(comment.awaitingApproval, isFalse);
  });

  test('the public list is asked for without the reader session', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().listComments(episodeId, token: 'page-2');

    final request = server.requestsTo('ListEpisodeComments').single;
    expect(request.body['episodePublicId'], episodeId);
    expect(request.body['token'], 'page-2');
    expect(request.headers.containsKey('authorization'), isFalse);
  });

  test(
    'a reader who is signed out asks for no comments of their own',
    () async {
      expect(await repository().listMyComments(episodeId), isEmpty);
      expect(server.requestsTo('ListMyEpisodeComments'), isEmpty);
    },
  );

  test(
    'the reader own comments carry no author and may await approval',
    () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myEpisodeComments = {
        episodeId: [
          {
            'publicId': 'SeedCMNTAAA2',
            'body': 'Still waiting.',
            'createdAt': '2026-09-08T11:00:00Z',
            'awaitingApproval': true,
          },
        ],
      };

      final comment = (await repository().listMyComments(episodeId)).single;
      expect(comment.id, 'SeedCMNTAAA2');
      expect(comment.awaitingApproval, isTrue);
      expect(comment.authorName, isEmpty);
    },
  );

  test('posting sends the body and answers with what was stored', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.commentMode = 'COMMENT_MODE_APPROVAL_REQUIRED';

    final posted = await repository().post(
      episodePublicId: episodeId,
      body: 'What an episode.',
    );

    expect(posted.body, 'What an episode.');
    expect(posted.awaitingApproval, isTrue);
    expect(
      server.requestsTo('PostEpisodeComment').single.body['body'],
      'What an episode.',
    );
  });

  test('posting without a session fails before the request', () async {
    await expectLater(
      repository().post(episodePublicId: episodeId, body: 'Anonymous.'),
      throwsA(
        isA<CommentFailure>().having(
          (failure) => failure.kind,
          'kind',
          CommentFailureKind.sessionExpired,
        ),
      ),
    );
    expect(server.requestsTo('PostEpisodeComment'), isEmpty);
  });

  test('withdrawing names the comment to take down', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().withdraw('SeedCMNTAAA1');

    expect(
      server
          .requestsTo('WithdrawEpisodeComment')
          .single
          .body['commentPublicId'],
      'SeedCMNTAAA1',
    );
  });

  test('a report carries the reason as the API names it', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().report(
      commentPublicId: 'SeedCMNTAAA1',
      reason: CommentReportReason.spoiler,
      note: 'It gives the ending away.',
    );

    final request = server.requestsTo('ReportEpisodeComment').single;
    expect(request.body['reason'], 'COMMENT_REPORT_REASON_SPOILER');
    expect(request.body['note'], 'It gives the ending away.');
  });

  test('an API that cannot be reached is a network failure', () async {
    server.commentStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().listComments(episodeId),
      throwsA(
        isA<CommentFailure>().having(
          (failure) => failure.kind,
          'kind',
          CommentFailureKind.network,
        ),
      ),
    );
  });
}
