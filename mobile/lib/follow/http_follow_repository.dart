import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/models/follow.dart';

/// [FollowRepository] backed by `publira.v1.FollowService`.
class HttpFollowRepository implements FollowRepository {
  const HttpFollowRepository({
    required ConnectClient client,
    required TenantResolver tenants,
  }) : _client = client,
       _tenants = tenants;

  static const _statusProcedure = '/publira.v1.FollowService/GetMyFollowStatus';
  static const _followProcedure = '/publira.v1.FollowService/Follow';
  static const _unfollowProcedure = '/publira.v1.FollowService/Unfollow';
  static const _listProcedure = '/publira.v1.FollowService/ListMyFollows';

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
    return _call(_statusProcedure, kind, targetId, accessToken);
  }

  // Both are `async` so a session that ended between the tap and the request
  // reaches the caller as a failed future rather than as a synchronous throw.
  @override
  Future<bool> follow(FollowTargetKind kind, String targetId) async =>
      _call(_followProcedure, kind, targetId, _requireSession());

  @override
  Future<bool> unfollow(FollowTargetKind kind, String targetId) async =>
      _call(_unfollowProcedure, kind, targetId, _requireSession());

  @override
  Future<MyFollowPage> listMyFollows({String token = ''}) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return MyFollowPage.empty;
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _listProcedure,
        {
          'limit': pageSize,
          'tenant': {'tenantId': tenantId},
          if (token.isNotEmpty) 'token': token,
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return MyFollowPage(
        follows: _follows(body['follows']),
        nextToken: _readString(body, 'nextToken'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// One of the three RPCs that name a target and answer with the state the
  /// API holds for it.
  Future<bool> _call(
    String procedure,
    FollowTargetKind kind,
    String targetId,
    String accessToken,
  ) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        procedure,
        {
          'target': {'publicId': targetId, 'type': kind.wireValue},
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      // protojson omits a false, which is what an unfollowed target and every
      // Unfollow answer arrive as.
      return body['isFollowing'] == true;
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

  List<MyFollow> _follows(Object? raw) {
    // protojson omits an empty repeated field, so a reader who follows nothing
    // arrives without the key at all.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const FollowFailure(
        FollowFailureKind.unexpected,
        message: 'follows must be a list',
      );
    }
    final follows = raw
        .map((item) => _expectMap(item, 'follows[]'))
        .map(_follow)
        // A kind this build cannot show, and a row naming no target, are rows
        // no screen could render.
        .nonNulls
        .toList();
    return List<MyFollow>.unmodifiable(follows);
  }

  MyFollow? _follow(Map<String, Object?> json) {
    final kind = FollowTargetKind.fromWire(json['targetType']);
    final targetId = _readString(json, 'targetPublicId');
    if (kind == null || targetId.isEmpty) {
      return null;
    }
    return MyFollow(
      kind: kind,
      targetId: targetId,
      followedAt: _readInstant(json, 'followedAt'),
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

  Map<String, Object?> _expectMap(Object? value, String path) {
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    throw FollowFailure(
      FollowFailureKind.unexpected,
      message: '$path must be an object',
    );
  }

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }

  /// The RFC 3339 timestamp under [key], or `null` when the API sent one this
  /// build could not read.
  DateTime? _readInstant(Map<String, Object?> json, String key) {
    return DateTime.tryParse(_readString(json, key))?.toLocal();
  }
}
