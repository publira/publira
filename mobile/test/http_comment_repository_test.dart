import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/comment.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/http_comment_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_comment.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const episodeId = ConnectFixtureServer.seedEpisodeId;
  final episodeInternalId = ConnectFixtureServer.internalIdOf(episodeId);

  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpCommentRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpCommentRepository(
      config: AppConfig(baseUrl: server.baseUrl, tenantHost: 'localhost'),
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    accessToken = '';
    server = ConnectFixtureServer(
      episodeComments: {
        episodeId: [
          pb.EpisodeComment(
            publicId: 'SeedCMNTAAA1',
            body: 'The first one.',
            createdAt: '2026-09-08T10:30:00Z',
            authorPublicId: 'SeedMMBRBBB2',
            authorName: 'Another Member',
          ),
        ],
      },
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('the tenant answers how it publishes comments', () async {
    server.commentMode = pb.CommentMode.COMMENT_MODE_APPROVAL_REQUIRED;

    expect(await repository().commentMode(), CommentMode.approvalRequired);
  });

  test('a mode this build cannot name takes no comments', () async {
    // A name this build does not know decodes as the zero value, which is
    // what the fixture answers here: the generated enum cannot carry one.
    server.commentMode = pb.CommentMode.COMMENT_MODE_UNSPECIFIED;

    expect(await repository().commentMode(), CommentMode.disabled);
  });

  test('the published comments map onto the rows a screen renders', () async {
    final page = await repository().listComments(episodeInternalId);

    final comment = page.comments.single;
    expect(comment.id, ConnectFixtureServer.internalIdOf('SeedCMNTAAA1'));
    expect(comment.body, 'The first one.');
    expect(comment.authorId, 'SeedMMBRBBB2');
    expect(comment.authorName, 'Another Member');
    expect(comment.createdAt, DateTime.utc(2026, 9, 8, 10, 30).toLocal());
    expect(comment.awaitingApproval, isFalse);
  });

  test('a comment by a credited creator carries the credited name', () async {
    server.episodeComments = {
      episodeId: [
        pb.EpisodeComment(
          publicId: 'SeedCMNTAAA3',
          body: 'Thank you for reading.',
          createdAt: '2026-09-08T10:45:00Z',
          authorPublicId: 'SeedMMBRCCC3',
          authorName: 'Sample Member',
          creator: pb.EpisodeCommentCreator(
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            publicId: 'SeedCRTRAAA1',
            name: 'Sample Author',
          ),
        ),
        pb.EpisodeComment(
          publicId: 'SeedCMNTAAA1',
          body: 'The first one.',
          createdAt: '2026-09-08T10:30:00Z',
          authorPublicId: 'SeedMMBRBBB2',
          authorName: 'Another Member',
        ),
      ],
    };

    final [creator, reader] = (await repository().listComments(
      episodeInternalId,
    )).comments;
    expect(creator.authorName, 'Sample Member');
    expect(creator.creatorName, 'Sample Author');
    expect(creator.displayName, 'Sample Author');
    expect(reader.creatorName, isEmpty);
    expect(reader.displayName, 'Another Member');
  });

  test('an author icon resolves against the image server', () async {
    server.episodeComments = {
      episodeId: [
        pb.EpisodeComment(
          publicId: 'SeedCMNTAAA3',
          body: 'I have a face.',
          createdAt: '2026-09-08T10:45:00Z',
          authorPublicId: 'SeedMMBRCCC3',
          authorName: 'Sample Member',
          authorIconImageVariants: [
            pb.UserIconVariant(
              label: 'icon',
              url: '/images/users/0190a0c0-0000-7000-8000-000000000001',
              contentType: 'image/webp',
              width: 512,
              height: 512,
            ),
          ],
        ),
        pb.EpisodeComment(
          publicId: 'SeedCMNTAAA1',
          body: 'The first one.',
          createdAt: '2026-09-08T10:30:00Z',
          authorPublicId: 'SeedMMBRBBB2',
          authorName: 'Another Member',
        ),
      ],
    };

    final [withIcon, withoutIcon] = (await repository().listComments(
      episodeInternalId,
    )).comments;
    expect(
      withIcon.authorIconUrl,
      Uri.parse(
        '${server.baseUrl}/images/users/0190a0c0-0000-7000-8000-000000000001',
      ),
    );
    expect(withIcon.imageRequestHeaders['x-forwarded-host'], 'localhost');
    // The wire format omits the empty list an account without an icon has.
    expect(withoutIcon.authorIconUrl, isNull);
  });

  test('the public list is asked for without the reader session', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().listComments(episodeInternalId, token: 'page-2');

    final call = server.requestsTo('ListEpisodeComments').single;
    final request = call.decode(pb.ListEpisodeCommentsRequest());
    expect(request.episodeId, episodeInternalId);
    expect(request.token, 'page-2');
    expect(call.headers.containsKey('authorization'), isFalse);
  });

  test(
    'a reader who is signed out asks for no comments of their own',
    () async {
      expect(await repository().listMyComments(episodeInternalId), isEmpty);
      expect(server.requestsTo('ListMyEpisodeComments'), isEmpty);
    },
  );

  test(
    'the reader own comments carry no author and may await approval',
    () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myEpisodeComments = {
        episodeId: [
          pb.MyEpisodeComment(
            publicId: 'SeedCMNTAAA2',
            body: 'Still waiting.',
            createdAt: '2026-09-08T11:00:00Z',
            awaitingApproval: true,
          ),
        ],
      };

      final comment = (await repository().listMyComments(
        episodeInternalId,
      )).single;
      expect(comment.id, ConnectFixtureServer.internalIdOf('SeedCMNTAAA2'));
      expect(comment.awaitingApproval, isTrue);
      expect(comment.authorName, isEmpty);
      expect(comment.creatorName, isEmpty);
    },
  );

  test(
    'the reader own comments keep the credit the episode gives them',
    () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      server.myEpisodeComments = {
        episodeId: [
          pb.MyEpisodeComment(
            publicId: 'SeedCMNTAAA2',
            body: 'Thank you for reading.',
            createdAt: '2026-09-08T11:00:00Z',
            awaitingApproval: true,
            creator: pb.EpisodeCommentCreator(
              id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              publicId: 'SeedCRTRAAA1',
              name: 'Sample Author',
            ),
          ),
        ],
      };

      final comment = (await repository().listMyComments(episodeInternalId))
          .single
          .byAuthor(id: 'SeedMMBRCCC3', name: 'Sample Member', iconUrl: null);
      expect(comment.creatorName, 'Sample Author');
      expect(comment.displayName, 'Sample Author');
    },
  );

  test('posting sends the body and answers with what was stored', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.commentMode = pb.CommentMode.COMMENT_MODE_APPROVAL_REQUIRED;

    final posted = await repository().post(
      episodeInternalId: episodeInternalId,
      body: 'What an episode.',
    );

    expect(posted.body, 'What an episode.');
    expect(posted.awaitingApproval, isTrue);
    expect(
      server.requestsOf(pb.PostEpisodeCommentRequest.new).single.body,
      'What an episode.',
    );
  });

  test('posting the same body again is a duplicate', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    final comments = repository();
    await comments.post(
      episodeInternalId: episodeInternalId,
      body: 'What an episode.',
    );

    await expectLater(
      comments.post(
        episodeInternalId: episodeInternalId,
        body: 'What an episode.',
      ),
      throwsA(
        isA<CommentFailure>().having(
          (failure) => failure.kind,
          'kind',
          CommentFailureKind.duplicate,
        ),
      ),
    );
  });

  test('posting without a session fails before the request', () async {
    await expectLater(
      repository().post(
        episodeInternalId: episodeInternalId,
        body: 'Anonymous.',
      ),
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
      server.requestsOf(pb.WithdrawEpisodeCommentRequest.new).single.commentId,
      'SeedCMNTAAA1',
    );
  });

  test('a report carries the reason as the API names it', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    await repository().report(
      commentId: 'SeedCMNTAAA1',
      reason: CommentReportReason.spoiler,
      note: 'It gives the ending away.',
    );

    final request = server
        .requestsOf(pb.ReportEpisodeCommentRequest.new)
        .single;
    expect(
      request.reason,
      pb.CommentReportReason.COMMENT_REPORT_REASON_SPOILER,
    );
    expect(request.note, 'It gives the ending away.');
  });

  test(
    'every call that names an episode or its comment names the app',
    () async {
      accessToken = ConnectFixtureServer.memberAccessToken;
      final comments = repository();

      await comments.listComments(episodeInternalId);
      await comments.listMyComments(episodeInternalId);
      await comments.post(
        episodeInternalId: episodeInternalId,
        body: 'Worth the wait.',
      );
      await comments.report(
        commentId: 'SeedCMNTAAA1',
        reason: CommentReportReason.spam,
      );

      final surfaces = {
        'ListEpisodeComments': server
            .requestsOf(pb.ListEpisodeCommentsRequest.new)
            .single
            .surface,
        'ListMyEpisodeComments': server
            .requestsOf(pb.ListMyEpisodeCommentsRequest.new)
            .single
            .surface,
        'PostEpisodeComment': server
            .requestsOf(pb.PostEpisodeCommentRequest.new)
            .single
            .surface,
        'ReportEpisodeComment': server
            .requestsOf(pb.ReportEpisodeCommentRequest.new)
            .single
            .surface,
      };
      for (final MapEntry(key: procedure, value: surface) in surfaces.entries) {
        expect(surface, appClientSurface, reason: procedure);
      }
    },
  );

  test('an API that cannot be reached is a network failure', () async {
    server.commentStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().listComments(episodeInternalId),
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
