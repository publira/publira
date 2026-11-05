import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/creator.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/comments/http_comment_repository.dart';
import 'package:publira/config.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_repository.dart';
import 'package:publira/models/my_creator.dart';

/// [CreatorRepository] backed by `publira.v1.CreatorService` and the tenant
/// setting `publira.v1.TenantService` answers with.
class HttpCreatorRepository implements CreatorRepository {
  const HttpCreatorRepository({
    required this._config,
    required this._client,
    required this._tenants,
  });

  final AppConfig _config;
  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<bool> pagesEnabled() async {
    try {
      final tenantId = await _tenants.resolve();
      final tenant = await pb.TenantServiceApi(_client).getTenant(
        ConnectCallContext(tenantId: tenantId),
        pb.GetTenantRequest(tenant: pb.TenantContext(tenantId: tenantId)),
      );
      return tenant.creatorPagesEnabled;
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<MyCreators> listMyCreators() async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CreatorServiceApi(_client).listMyCreators(
        ConnectCallContext(tenantId: tenantId),
        pb.ListMyCreatorsRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
        ),
      );
      return MyCreators(
        creators: List.unmodifiable([
          for (final creator in body.creators)
            // The other calls name the creator by this id, so a row without
            // one leads nowhere.
            if (creator.id.trim().isNotEmpty) _creator(creator),
        ]),
        salesVisible: body.salesVisible,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  MyCreator _creator(pb.MyCreator creator) {
    final iconUrl = creator.iconImageUrl.trim();
    return MyCreator(
      id: creator.id.trim(),
      publicId: creator.publicId.trim(),
      name: creator.name.trim(),
      // The wire format omits an empty string, which is a creator with no
      // portrait.
      iconUrl: iconUrl.isEmpty ? null : _config.imageUri(iconUrl),
      imageRequestHeaders: _config.publicImageRequestHeaders,
    );
  }

  @override
  Future<MyCreatorStats> stats({
    required String creatorId,
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CreatorServiceApi(_client).getMyCreatorStats(
        ConnectCallContext(tenantId: tenantId),
        pb.GetMyCreatorStatsRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          creatorId: creatorId,
          locale: locale,
          token: token.isEmpty ? null : token,
        ),
      );
      return MyCreatorStats(
        periodStart: _readDate(body.periodStart),
        periodEnd: _readDate(body.periodEnd),
        timeZone: body.timeZone,
        followerCount: body.followerCount.toInt(),
        totalMemberViewCount: body.totalMemberViewCount.toInt(),
        totalCompleteCount: body.totalCompleteCount.toInt(),
        currency: body.currency,
        episodes: List.unmodifiable([
          for (final episode in body.episodes)
            MyCreatorEpisodeStats(
              seriesPublicId: episode.seriesPublicId,
              seriesTitle: episode.seriesTitle,
              episodePublicId: episode.episodePublicId,
              episodeTitle: episode.episodeTitle,
              memberViewCount: episode.memberViewCount.toInt(),
              completeCount: episode.completeCount.toInt(),
              // Unset, rather than zero, while the tenant hides sales.
              purchaseCount: episode.hasPurchaseCount()
                  ? episode.purchaseCount.toInt()
                  : null,
              netAmount: episode.hasNetAmount()
                  ? episode.netAmount.toInt()
                  : null,
            ),
        ]),
        nextToken: body.nextToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<MyCreatorStatementPage> listStatements({
    required String creatorId,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CreatorServiceApi(_client).listMyCreatorStatements(
        ConnectCallContext(tenantId: tenantId),
        pb.ListMyCreatorStatementsRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          creatorId: creatorId,
          token: token.isEmpty ? null : token,
        ),
      );
      return MyCreatorStatementPage(
        statements: List.unmodifiable(body.statements.map(_statement)),
        nextToken: body.nextToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<MyCreatorStatementDetail> statement({
    required String creatorId,
    required String period,
    String token = '',
    int? limit,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CreatorServiceApi(_client).getMyCreatorStatement(
        ConnectCallContext(tenantId: tenantId),
        pb.GetMyCreatorStatementRequest(
          tenant: pb.TenantContext(tenantId: tenantId),
          surface: appClientSurface,
          creatorId: creatorId,
          period: period,
          limit: limit,
          token: token.isEmpty ? null : token,
        ),
      );
      return MyCreatorStatementDetail(
        statement: _statement(body.statement),
        lines: List.unmodifiable([
          for (final line in body.lines)
            MyCreatorStatementLine(
              lineNumber: line.lineNumber,
              seriesPublicId: line.seriesPublicId,
              seriesTitle: line.seriesTitle,
              episodePublicId: line.episodePublicId,
              episodeTitle: line.episodeTitle,
              roleName: line.roleName,
              saleCount: line.saleCount,
              grossAmount: line.grossAmount.toInt(),
              refundedAmount: line.refundedAmount.toInt(),
              shareBps: line.shareBps,
              payoutAmount: line.payoutAmount.toInt(),
              adjustedPeriod: line.adjustedPeriod,
              source: switch (line.source) {
                pb
                    .CreatorStatementLineSource
                    .CREATOR_STATEMENT_LINE_SOURCE_TIP =>
                  CreatorStatementLineSource.tip,
                pb
                    .CreatorStatementLineSource
                    .CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION =>
                  CreatorStatementLineSource.subscription,
                _ => CreatorStatementLineSource.sale,
              },
            ),
        ]),
        nextToken: body.nextToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  @override
  Future<MyCreatorEpisodeCommentPage> listEpisodeComments({
    required String creatorId,
    required String locale,
    String token = '',
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      final body = await pb.CreatorServiceApi(_client)
          .listMyCreatorEpisodeComments(
            ConnectCallContext(tenantId: tenantId),
            pb.ListMyCreatorEpisodeCommentsRequest(
              tenant: pb.TenantContext(tenantId: tenantId),
              surface: appClientSurface,
              creatorId: creatorId,
              locale: locale,
              token: token.isEmpty ? null : token,
            ),
          );
      return MyCreatorEpisodeCommentPage(
        comments: List.unmodifiable([
          for (final row in body.comments)
            MyCreatorEpisodeComment(
              comment: publishedEpisodeComment(row.comment, _config),
              seriesPublicId: row.seriesPublicId.trim(),
              seriesTitle: row.seriesTitle.trim(),
              episodePublicId: row.episodePublicId.trim(),
              episodeTitle: row.episodeTitle.trim(),
            ),
        ]),
        previousToken: body.previousToken.trim(),
        nextToken: body.nextToken.trim(),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  MyCreatorStatement _statement(pb.MyCreatorStatement statement) {
    final closedAt = DateTime.tryParse(statement.closedAt.trim());
    if (closedAt == null) {
      throw const CreatorFailure(
        CreatorFailureKind.unexpected,
        message: 'closed_at must be an RFC 3339 timestamp',
      );
    }
    return MyCreatorStatement(
      period: statement.period,
      timeZone: statement.timeZone,
      closedAt: closedAt.toLocal(),
      currency: statement.currency,
      saleCount: statement.saleCount.toInt(),
      grossAmount: statement.grossAmount.toInt(),
      refundedAmount: statement.refundedAmount.toInt(),
      payoutAmount: statement.payoutAmount.toInt(),
    );
  }

  /// A `YYYY-MM-DD` the API sends as a day of the tenant's zone, read by its
  /// fields so no zone can move it.
  DateTime _readDate(String value) {
    final date = DateTime.tryParse(value.trim());
    if (date == null) {
      throw const CreatorFailure(
        CreatorFailureKind.unexpected,
        message: 'the window must be given as YYYY-MM-DD',
      );
    }
    return DateTime(date.year, date.month, date.day);
  }

  CreatorFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return CreatorFailure(CreatorFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'unauthenticated' => CreatorFailure(
        CreatorFailureKind.sessionExpired,
        message: error.message,
      ),
      // The pages turned off, sales hidden, an Author the account is not
      // linked to, and a month that is not closed all leave nothing to show.
      'failed_precondition' || 'not_found' || 'permission_denied' =>
        CreatorFailure(CreatorFailureKind.unavailable, message: error.message),
      _ => CreatorFailure(
        CreatorFailureKind.unexpected,
        message: error.message,
      ),
    };
  }
}
