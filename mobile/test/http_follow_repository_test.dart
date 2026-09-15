import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/http_follow_repository.dart';
import 'package:publira/models/follow.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const seriesId = ConnectFixtureServer.seedSeriesId;
  const creatorId = 'SeedAUTHAAA1';

  /// One `MyFollow` row as the API answers it.
  Map<String, Object?> row(
    FollowTargetKind kind,
    String targetId, {
    String followedAt = '2026-09-08T10:30:00Z',
  }) {
    return {
      'targetType': kind.wireValue,
      'targetPublicId': targetId,
      'followedAt': followedAt,
    };
  }

  late ConnectFixtureServer server;
  late String accessToken;

  /// The repository as a reader holding [accessToken] — empty for a guest.
  HttpFollowRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpFollowRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  setUp(() async {
    accessToken = '';
    server = ConnectFixtureServer();
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('a reader who is signed out is not asked about a follow', () async {
    expect(
      await repository().isFollowing(FollowTargetKind.series, seriesId),
      isFalse,
    );
    expect(server.requestsTo('GetMyFollowStatus'), isEmpty);
  });

  test('the state names the target the way the API does', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.myFollows = [row(FollowTargetKind.series, seriesId)];

    expect(
      await repository().isFollowing(FollowTargetKind.series, seriesId),
      isTrue,
    );

    final request = server.requestsTo('GetMyFollowStatus').single;
    expect(request.body['target'], {
      'publicId': seriesId,
      'type': 'FOLLOW_TARGET_TYPE_SERIES',
    });
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a target the reader does not follow answers false', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    expect(
      await repository().isFollowing(FollowTargetKind.creator, creatorId),
      isFalse,
    );
  });

  test('following a creator is answered with the state stored', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    expect(
      await repository().follow(FollowTargetKind.creator, creatorId),
      isTrue,
    );

    expect(server.requestsTo('Follow').single.body['target'], {
      'publicId': creatorId,
      'type': 'FOLLOW_TARGET_TYPE_CREATOR',
    });
    final follow = (await repository().listMyFollows()).follows.single;
    expect(follow.kind, FollowTargetKind.creator);
    expect(follow.targetId, creatorId);
  });

  test('unfollowing takes the target off the list', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.myFollows = [row(FollowTargetKind.series, seriesId)];

    expect(
      await repository().unfollow(FollowTargetKind.series, seriesId),
      isFalse,
    );

    expect((await repository().listMyFollows()).follows, isEmpty);
  });

  test('the rows map onto what a list renders', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.myFollows = [
      row(FollowTargetKind.series, seriesId),
      row(FollowTargetKind.creator, creatorId),
    ];

    final page = await repository().listMyFollows();

    expect(page.follows.first.kind, FollowTargetKind.series);
    expect(page.follows.first.targetId, seriesId);
    expect(
      page.follows.first.followedAt,
      DateTime.utc(2026, 9, 8, 10, 30).toLocal(),
    );
    expect(page.follows.last.kind, FollowTargetKind.creator);
    expect(page.nextToken, isEmpty);
  });

  test('a page carries the token of the page under it', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server
      ..myFollows = [
        row(FollowTargetKind.series, seriesId),
        row(FollowTargetKind.creator, creatorId),
      ]
      ..followsPageSize = 1;

    final first = await repository().listMyFollows();
    expect(first.follows.single.targetId, seriesId);
    expect(first.nextToken, isNotEmpty);

    final second = await repository().listMyFollows(token: first.nextToken);
    expect(second.follows.single.targetId, creatorId);
    expect(second.nextToken, isEmpty);
  });

  test('a row this build cannot show is left out of the list', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.myFollows = [
      {
        'targetType': 'FOLLOW_TARGET_TYPE_EPISODE',
        'targetPublicId': ConnectFixtureServer.seedEpisodeId,
        'followedAt': '2026-09-08T10:30:00Z',
      },
      row(FollowTargetKind.series, seriesId),
    ];

    final page = await repository().listMyFollows();

    expect(page.follows.single.targetId, seriesId);
  });

  test('a reader who follows nothing reads as an empty page', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;

    final page = await repository().listMyFollows();

    // protojson omits an empty repeated field, so the answer carries no
    // `follows` key at all.
    expect(server.requestsTo('ListMyFollows'), hasLength(1));
    expect(page.follows, isEmpty);
    expect(page.nextToken, isEmpty);
  });

  test('a reader who is signed out asks for no list of their own', () async {
    expect((await repository().listMyFollows()).follows, isEmpty);
    expect(server.requestsTo('ListMyFollows'), isEmpty);
  });

  test('following without a session fails before the request', () async {
    await expectLater(
      repository().follow(FollowTargetKind.series, seriesId),
      throwsA(
        isA<FollowFailure>().having(
          (failure) => failure.kind,
          'kind',
          FollowFailureKind.sessionExpired,
        ),
      ),
    );
    expect(server.requestsTo('Follow'), isEmpty);
  });

  test('a session the API no longer takes asks for a sign-in', () async {
    accessToken = 'stale-token';

    await expectLater(
      repository().follow(FollowTargetKind.series, seriesId),
      throwsA(
        isA<FollowFailure>().having(
          (failure) => failure.kind,
          'kind',
          FollowFailureKind.sessionExpired,
        ),
      ),
    );
  });

  test('an API that cannot be reached is a network failure', () async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server.followStatus = HttpStatus.serviceUnavailable;

    await expectLater(
      repository().listMyFollows(),
      throwsA(
        isA<FollowFailure>().having(
          (failure) => failure.kind,
          'kind',
          FollowFailureKind.network,
        ),
      ),
    );
  });
}
