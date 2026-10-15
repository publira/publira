import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/comment.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/api/user_icon.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/models/episode_comment.dart';

/// [CommentRepository] backed by `publira.v1.CommentService` and the tenant
/// setting `publira.v1.TenantService` answers with.
class HttpCommentRepository implements CommentRepository {
  const HttpCommentRepository({
    required this._config,
    required this._client,
    required this._tenants,
  });

  /// Rows one page asks for. The API caps this at 100 and falls back to 20.
  static const _pageSize = 20;

  /// How many of the reader's own comments are read beside a public page.
  ///
  /// These are only the ones the public list cannot carry, so a reader has a
  /// handful of them on an episode at most. Asking for the server's maximum in
  /// one request is what lets them be placed by date among the public rows
  /// instead of being paged on their own.
  static const _ownPageSize = 100;

  final AppConfig _config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<CommentMode> commentMode() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.TenantServiceApi(_client).getTenant(
        ConnectCallContext(tenantId: tenantId),
        pb.GetTenantRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
      return CommentMode.fromWire(body.commentMode);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeCommentPage> listComments(
    String episodeInternalId, {
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      // Deliberately anonymous even for a signed-in reader: this list is the
      // same for everyone, and every comment in another state reaches its
      // author through listMyComments instead.
      final body = await pb.CommentServiceApi(_client).listEpisodeComments(
        ConnectCallContext(tenantId: tenantId, accessToken: ''),
        pb.ListEpisodeCommentsRequest(
          episodeId: episodeInternalId,
          limit: _pageSize,
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          token: token,
        ),
      );
      return EpisodeCommentPage(
        comments: List<EpisodeComment>.unmodifiable(
          body.comments.map(_publicComment),
        ),
        previousToken: body.previousToken.trim(),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<List<EpisodeComment>> listMyComments(String episodeInternalId) async {
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
      final body = await pb.CommentServiceApi(_client).listMyEpisodeComments(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ListMyEpisodeCommentsRequest(
          episodeId: episodeInternalId,
          limit: _ownPageSize,
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          token: '',
        ),
      );
      return List<EpisodeComment>.unmodifiable(body.comments.map(_ownComment));
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<EpisodeComment> post({
    required String episodeInternalId,
    required String body,
  }) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      final response = await pb.CommentServiceApi(_client).postEpisodeComment(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.PostEpisodeCommentRequest(
          body: body,
          episodeId: episodeInternalId,
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
        ),
      );
      if (!response.hasComment()) {
        throw const CommentFailure(
          CommentFailureKind.unexpected,
          message: 'comment must be an object',
        );
      }
      return _ownComment(response.comment);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> withdraw(String commentId) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      await pb.CommentServiceApi(_client).withdrawEpisodeComment(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.WithdrawEpisodeCommentRequest(
          commentId: commentId,
          tenant: pb.TenantContext(tenantId: tenantId),
        ),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<void> report({
    required String commentId,
    required CommentReportReason reason,
    String note = '',
  }) async {
    final accessToken = _requireSession();
    try {
      final tenantId = await _tenants.resolve();
      await pb.CommentServiceApi(_client).reportEpisodeComment(
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.ReportEpisodeCommentRequest(
          commentId: commentId,
          note: note,
          reason: switch (reason) {
            CommentReportReason.spam =>
              pb.CommentReportReason.COMMENT_REPORT_REASON_SPAM,
            CommentReportReason.abuse =>
              pb.CommentReportReason.COMMENT_REPORT_REASON_ABUSE,
            CommentReportReason.spoiler =>
              pb.CommentReportReason.COMMENT_REPORT_REASON_SPOILER,
            CommentReportReason.other =>
              pb.CommentReportReason.COMMENT_REPORT_REASON_OTHER,
          },
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
        ),
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
  EpisodeComment _publicComment(pb.EpisodeComment comment) {
    return EpisodeComment(
      id: comment.id.trim(),
      body: comment.body.trim(),
      createdAt: _readInstant(comment.createdAt),
      authorId: comment.authorPublicId.trim(),
      authorName: comment.authorName.trim(),
      authorIconUrl: userIconUrl(comment.authorIconImageVariants, _config),
      imageRequestHeaders: _config.publicImageRequestHeaders,
      creatorName: _creatorName(comment.creator),
    );
  }

  /// One of the caller's own comments, which names no author: it is the
  /// caller, and the API does not repeat their name or icon back to them.
  EpisodeComment _ownComment(pb.MyEpisodeComment comment) {
    return EpisodeComment(
      id: comment.id.trim(),
      body: comment.body.trim(),
      createdAt: _readInstant(comment.createdAt),
      imageRequestHeaders: _config.publicImageRequestHeaders,
      creatorName: _creatorName(comment.creator),
      awaitingApproval: comment.awaitingApproval,
    );
  }

  /// The name the episode credits the comment's author as, empty when it
  /// credits them as nothing: the wire format omits the unset `creator` message
  /// every other comment carries, which reads as one without a name.
  String _creatorName(pb.EpisodeCommentCreator creator) => creator.name.trim();

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
      'already_exists' => CommentFailure(
        CommentFailureKind.duplicate,
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

  /// The RFC 3339 timestamp [value], or `null` when the API sent one this
  /// build could not read. A row without a date still renders: its text is
  /// what the reader came for.
  DateTime? _readInstant(String value) {
    return DateTime.tryParse(value.trim())?.toLocal();
  }
}
