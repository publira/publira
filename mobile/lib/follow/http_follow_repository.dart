import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/models/follow.dart';

/// [FollowRepository] backed by `publira.v1.FollowService`.
class HttpFollowRepository implements FollowRepository {
  const HttpFollowRepository({required this._client, required this._tenants});

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const pageSize = 20;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<bool> isFollowing(FollowTargetKind kind, String targetId) async {
    // The API answers a request without a session `unauthenticated`, and a
    // reader who is signed out follows nothing, so asking would spend a round
    // trip on the answer the control already has.
    //
    // The token is read here and sent explicitly rather than left for the
    // client to resolve at request time, which is what ties the answer to the
    // reader the caller asked about: a sign-out and a second sign-in while the
    // tenant lookup is in flight would otherwise show one reader another's
    // follow.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return false;
    }
    return _call(
      kind,
      targetId,
      accessToken,
      (api, call, tenant, target) async => (await api.getMyFollowStatus(
        call,
        pb.GetMyFollowStatusRequest(
          tenant: tenant,
          target: target,
          surface: appClientSurface,
        ),
      )).isFollowing,
    );
  }

  // Both are `async` so a session that ended between the tap and the request
  // reaches the caller as a failed future rather than as a synchronous throw.
  @override
  Future<bool> follow(FollowTargetKind kind, String targetId) async => _call(
    kind,
    targetId,
    _requireSession(),
    (api, call, tenant, target) async => (await api.follow(
      call,
      pb.FollowRequest(
        tenant: tenant,
        target: target,
        surface: appClientSurface,
      ),
    )).isFollowing,
  );

  @override
  Future<bool> unfollow(FollowTargetKind kind, String targetId) async => _call(
    kind,
    targetId,
    _requireSession(),
    (api, call, tenant, target) async => (await api.unfollow(
      call,
      pb.UnfollowRequest(
        tenant: tenant,
        target: target,
        surface: appClientSurface,
      ),
    )).isFollowing,
  );

  @override
  Future<MyFollowPage> listMyFollows({String token = ''}) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return MyFollowPage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.FollowServiceApi(_client).listMyFollows(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyFollowsRequest(
          limit: pageSize,
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          token: token.isEmpty ? null : token,
        ),
      );
      return MyFollowPage(
        follows: List<MyFollow>.unmodifiable(
          body.follows
              .map(_follow)
              // A kind this build cannot show, and a row naming no target,
              // are rows no screen could render.
              .nonNulls,
        ),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// One of the three RPCs that name a target and answer with the state the
  /// API holds for it, which [send] makes through `api` with the context, the
  /// tenant, and the target every one of them carries.
  Future<bool> _call(
    FollowTargetKind kind,
    String targetId,
    String accessToken,
    Future<bool> Function(
      pb.FollowServiceApi api,
      ConnectCallContext call,
      pb.TenantContext tenant,
      pb.FollowTarget target,
    )
    send,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        pb.FollowServiceApi(_client),
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.TenantContext(tenantId: tenantId),
        pb.FollowTarget(
          id: targetId,
          type: switch (kind) {
            FollowTargetKind.series =>
              pb.FollowTargetType.FOLLOW_TARGET_TYPE_SERIES,
            FollowTargetKind.creator =>
              pb.FollowTargetType.FOLLOW_TARGET_TYPE_CREATOR,
          },
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The token every write carries, or the failure the reader is shown.
  ///
  /// A screen offers these controls only to a signed-in reader, so an empty
  /// token here is a session that ended between the tap and the request.
  String _requireSession() {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const FollowFailure(
        FollowFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    return accessToken;
  }

  MyFollow? _follow(pb.MyFollow follow) {
    final kind = FollowTargetKind.fromWire(follow.targetType);
    final targetId = follow.targetPublicId.trim();
    final targetInternalId = follow.targetId.trim();
    if (kind == null || targetId.isEmpty || targetInternalId.isEmpty) {
      return null;
    }
    return MyFollow(
      kind: kind,
      targetId: targetId,
      targetInternalId: targetInternalId,
      // `null` when the API sent a timestamp this build could not read.
      followedAt: DateTime.tryParse(follow.followedAt.trim())?.toLocal(),
    );
  }

  FollowFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return FollowFailure(FollowFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'unauthenticated' => FollowFailure(
        FollowFailureKind.sessionExpired,
        message: error.message,
      ),
      'not_found' || 'permission_denied' => FollowFailure(
        FollowFailureKind.gone,
        message: error.message,
      ),
      _ => FollowFailure(FollowFailureKind.unexpected, message: error.message),
    };
  }
}
