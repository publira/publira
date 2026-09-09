import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/models/episode_comment.dart';

/// [CommentRepository] backed by `publira.v1.CommentService` and the tenant
/// setting `publira.v1.TenantService` answers with.
class HttpCommentRepository implements CommentRepository {
  const HttpCommentRepository({
    required ConnectClient client,
    required TenantResolver tenants,
  }) : _client = client,
       _tenants = tenants;

  static const _tenantProcedure = '/publira.v1.TenantService/GetTenant';
  static const _listProcedure =
      '/publira.v1.CommentService/ListEpisodeComments';
  static const _listMineProcedure =
      '/publira.v1.CommentService/ListMyEpisodeComments';
  static const _postProcedure = '/publira.v1.CommentService/PostEpisodeComment';
  static const _withdrawProcedure =
      '/publira.v1.CommentService/WithdrawEpisodeComment';
  static const _reportProcedure =
      '/publira.v1.CommentService/ReportEpisodeComment';

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const _pageSize = 20;

  /// How many of the reader's own comments are read beside a public page.
  ///
  /// These are only the ones the public list cannot carry, so a reader has a
  /// handful of them on an episode at most. Asking for the server's maximum in
  /// one request is what lets them be placed by date among the public rows
  /// instead of being paged on their own.
  static const _ownPageSize = 100;

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<CommentMode> commentMode() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(_tenantProcedure, {
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
      return CommentMode.fromWire(body['commentMode']);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeCommentPage> listComments(
    String episodePublicId, {
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      // Deliberately anonymous even for a signed-in reader: this list is the
      // same for everyone, and every comment in another state reaches its
      // author through listMyComments instead.
      final body = await _client.unary(
        _listProcedure,
        {
          'episodePublicId': episodePublicId,
          'limit': _pageSize,
          'tenant': {'tenantId': tenantId},
          'token': token,
        },
        tenantId: tenantId,
        accessToken: '',
      );
      return EpisodeCommentPage(
        comments: _comments(body['comments'], _publicComment),
        previousToken: _readString(body, 'previousToken'),
        nextToken: _readString(body, 'nextToken'),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<List<EpisodeComment>> listMyComments(String episodePublicId) async {
    // The API answers a request without a session `unauthenticated`, and a
    // reader who is signed out has no comments of their own to fold in, so
    // asking would spend a round trip on the answer the screen already has.
    //
    // The token is read here and sent explicitly rather than left for the
    // client to resolve at request time, which is what ties the answer to the
    // reader the caller asked about: a sign-out and a second sign-in while the
    // tenant lookup is in flight would otherwise show one reader another's
    // pending comment.
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      return const [];
    }
    try {
      final tenantId = await _tenants.resolve();
      final body = await _client.unary(
        _listMineProcedure,
        {
          'episodePublicId': episodePublicId,
          'limit': _ownPageSize,
          'tenant': {'tenantId': tenantId},
          'token': '',
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return _comments(body['comments'], _ownComment);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeComment> post({
    required String episodePublicId,
    required String body,
  }) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      final response = await _client.unary(
        _postProcedure,
        {
          'body': body,
          'episodePublicId': episodePublicId,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
      return _ownComment(_expectMap(response['comment'], 'comment'));
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> withdraw(String commentPublicId) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(
        _withdrawProcedure,
        {
          'commentPublicId': commentPublicId,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> report({
    required String commentPublicId,
    required CommentReportReason reason,
    String note = '',
  }) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      await _client.unary(
        _reportProcedure,
        {
          'commentPublicId': commentPublicId,
          'note': note,
          'reason': reason.wireValue,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// The token every write carries, or the failure the reader is shown.
  ///
  /// The screen offers these controls only to a signed-in reader, so an empty
  /// token here is a session that ended between the tap and the request.
  String _requireSession() {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const CommentFailure(
        CommentFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    return accessToken;
  }

  /// One published comment, as every visitor of the episode sees it.
  EpisodeComment _publicComment(Map<String, Object?> json) {
    return EpisodeComment(
      id: _readString(json, 'publicId'),
      body: _readString(json, 'body'),
      createdAt: _readInstant(json, 'createdAt'),
      authorId: _readString(json, 'authorPublicId'),
      authorName: _readString(json, 'authorName'),
    );
  }

  /// One of the caller's own comments, which names no author: it is the
  /// caller, and the API does not repeat their name back to them.
  EpisodeComment _ownComment(Map<String, Object?> json) {
    return EpisodeComment(
      id: _readString(json, 'publicId'),
      body: _readString(json, 'body'),
      createdAt: _readInstant(json, 'createdAt'),
      awaitingApproval: _readBool(json, 'awaitingApproval'),
    );
  }

  List<EpisodeComment> _comments(
    Object? raw,
    EpisodeComment Function(Map<String, Object?>) read,
  ) {
    // protojson omits an empty repeated field, so an episode nobody has
    // commented on arrives without the key at all.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const CommentFailure(
        CommentFailureKind.unexpected,
        message: 'comments must be a list',
      );
    }
    return List<EpisodeComment>.unmodifiable(
      raw.map((item) => read(_expectMap(item, 'comments[]'))),
    );
  }

  CommentFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return CommentFailure(CommentFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'unauthenticated' => CommentFailure(
        CommentFailureKind.sessionExpired,
        message: error.message,
      ),
      'resource_exhausted' => CommentFailure(
        CommentFailureKind.rateLimited,
        message: error.message,
      ),
      'invalid_argument' => CommentFailure(
        CommentFailureKind.rejected,
        message: error.message,
      ),
      // Commenting turned off, a body the reader may not read, and their own
      // comment reported: all three are the same answer to the reader, who is
      // looking at a control the API will not act on.
      'failed_precondition' || 'permission_denied' => CommentFailure(
        CommentFailureKind.notAllowed,
        message: error.message,
      ),
      'not_found' => CommentFailure(
        CommentFailureKind.gone,
        message: error.message,
      ),
      _ => CommentFailure(
        CommentFailureKind.unexpected,
        message: error.message,
      ),
    };
  }

  Map<String, Object?> _expectMap(Object? value, String path) {
    if (value is Map) {
      return value.map((key, item) => MapEntry(key.toString(), item));
    }
    throw CommentFailure(
      CommentFailureKind.unexpected,
      message: '$path must be an object',
    );
  }

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }

  bool _readBool(Map<String, Object?> json, String key) {
    // protojson omits a false, which is what a published comment arrives as.
    final value = json[key];
    return value is bool && value;
  }

  /// The RFC 3339 timestamp under [key], or `null` when the API sent one this
  /// build could not read. A row without a date still renders: its text is
  /// what the reader came for.
  DateTime? _readInstant(Map<String, Object?> json, String key) {
    return DateTime.tryParse(_readString(json, key))?.toLocal();
  }
}
