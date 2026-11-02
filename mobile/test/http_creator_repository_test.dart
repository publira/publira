import 'dart:io';

import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/creator.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/domain.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/config.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/http_creator_repository.dart';
import 'package:publira/models/my_creator.dart';

import 'support/proto_response.dart';

void main() {
  const tenantId = 'TENANT000001';
  const config = AppConfig(
    baseUrl: 'https://example.test',
    tenantHost: 'books.example.test',
  );

  /// The requests the API was sent, by method name, after the tenant lookup.
  late Map<String, List<http.Request>> requests;

  /// What each method answers, by name.
  late Map<String, http.Response Function()> answers;

  HttpCreatorRepository repository() {
    final client = ConnectClient(
      baseUrl: config.baseUrl,
      httpClient: MockClient((request) async {
        final method = request.url.pathSegments.last;
        if (method == 'GetTenantByDomain') {
          return protoResponse(
            pb.GetTenantByDomainResponse(tenantId: tenantId),
          );
        }
        (requests[method] ??= []).add(request);
        return answers[method]!();
      }),
    );
    return HttpCreatorRepository(
      config: config,
      client: client,
      tenants: TenantResolver(client: client, tenantHost: config.tenantHost),
    );
  }

  T decoded<T extends GeneratedMessage>(String method, T message) =>
      message..mergeFromBuffer(requests[method]!.single.bodyBytes);

  http.Response refusal(String code, int status) =>
      http.Response('{"code":"$code","message":"$code"}', status);

  setUp(() {
    requests = {};
    answers = {};
  });

  test('reads whether the tenant shows its Authors their pages', () async {
    answers['GetTenant'] = () =>
        protoResponse(pb.GetTenantResponse(creatorPagesEnabled: true));

    expect(await repository().pagesEnabled(), isTrue);
  });

  test('lists the linked Authors with their portraits', () async {
    answers['ListMyCreators'] = () => protoResponse(
      pb.ListMyCreatorsResponse(
        creators: [
          pb.MyCreator(
            id: 'creator-1',
            publicId: 'AUTHOR000001',
            name: 'Mina Harbor',
            iconImageUrl: '/images/creators/1',
          ),
          pb.MyCreator(id: 'creator-2', publicId: 'AUTHOR000002', name: 'Jun'),
        ],
        salesVisible: true,
      ),
    );

    final creators = await repository().listMyCreators();

    expect(
      decoded('ListMyCreators', pb.ListMyCreatorsRequest()),
      pb.ListMyCreatorsRequest(
        tenant: pb.TenantContext(tenantId: tenantId),
        surface: appClientSurface,
      ),
    );
    expect(creators.salesVisible, isTrue);
    expect(creators.creators.map((creator) => creator.id), [
      'creator-1',
      'creator-2',
    ]);
    expect(
      creators.creators.first.iconUrl,
      Uri.parse('https://example.test/images/creators/1'),
    );
    expect(creators.creators.first.imageRequestHeaders, {
      'x-forwarded-host': 'books.example.test',
    });
    expect(creators.creators.last.iconUrl, isNull);
  });

  test('reads the figures, telling hidden sales from none', () async {
    answers['GetMyCreatorStats'] = () => protoResponse(
      pb.GetMyCreatorStatsResponse(
        periodStart: '2026-10-04',
        periodEnd: '2026-10-31',
        timeZone: 'Asia/Tokyo',
        followerCount: Int64(1234),
        totalMemberViewCount: Int64(30),
        totalCompleteCount: Int64(9),
        currency: 'JPY',
        episodes: [
          pb.MyCreatorEpisodeStats(
            episodePublicId: 'EPISODE00001',
            memberViewCount: Int64(30),
            completeCount: Int64(9),
            purchaseCount: Int64.ZERO,
            netAmount: Int64.ZERO,
          ),
          pb.MyCreatorEpisodeStats(episodePublicId: 'EPISODE00002'),
        ],
        nextToken: 'next',
      ),
    );

    final stats = await repository().stats(
      creatorId: 'creator-1',
      locale: 'ja',
      token: 'page-2',
    );

    expect(
      decoded('GetMyCreatorStats', pb.GetMyCreatorStatsRequest()),
      pb.GetMyCreatorStatsRequest(
        tenant: pb.TenantContext(tenantId: tenantId),
        surface: appClientSurface,
        creatorId: 'creator-1',
        locale: 'ja',
        token: 'page-2',
      ),
    );
    expect(stats.periodStart, DateTime(2026, 10, 4));
    expect(stats.periodEnd, DateTime(2026, 10, 31));
    expect(stats.followerCount, 1234);
    expect(stats.nextToken, 'next');
    expect(stats.episodes.first.purchaseCount, 0);
    expect(stats.episodes.first.netAmount, 0);
    expect(stats.episodes.last.purchaseCount, isNull);
    expect(stats.episodes.last.netAmount, isNull);
  });

  test('reads a closed month and its lines', () async {
    answers['GetMyCreatorStatement'] = () => protoResponse(
      pb.GetMyCreatorStatementResponse(
        statement: pb.MyCreatorStatement(
          period: '2025-12',
          timeZone: 'UTC',
          closedAt: '2026-01-05T10:00:00Z',
          currency: 'JPY',
          saleCount: Int64(8),
          payoutAmount: Int64(1200),
        ),
        lines: [
          pb.MyCreatorStatementLine(
            lineNumber: 7,
            saleCount: -1,
            grossAmount: Int64(-500),
            payoutAmount: Int64(-150),
            shareBps: 3000,
            adjustedPeriod: '2025-11',
            source: pb
                .CreatorStatementLineSource
                .CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION,
          ),
        ],
      ),
    );

    final detail = await repository().statement(
      creatorId: 'creator-1',
      period: '2025-12',
      limit: 100,
    );

    expect(
      decoded('GetMyCreatorStatement', pb.GetMyCreatorStatementRequest()),
      pb.GetMyCreatorStatementRequest(
        tenant: pb.TenantContext(tenantId: tenantId),
        surface: appClientSurface,
        creatorId: 'creator-1',
        period: '2025-12',
        limit: 100,
      ),
    );
    expect(detail.statement.closedAt.toUtc(), DateTime.utc(2026, 1, 5, 10));
    expect(detail.statement.payoutAmount, 1200);
    final line = detail.lines.single;
    expect(line.isAdjustment, isTrue);
    expect(line.source, CreatorStatementLineSource.subscription);
    expect(line.grossAmount, -500);
  });

  for (final (code, status, kind) in [
    (
      'failed_precondition',
      HttpStatus.badRequest,
      CreatorFailureKind.unavailable,
    ),
    ('not_found', HttpStatus.notFound, CreatorFailureKind.unavailable),
    (
      'unauthenticated',
      HttpStatus.unauthorized,
      CreatorFailureKind.sessionExpired,
    ),
    ('internal', HttpStatus.internalServerError, CreatorFailureKind.unexpected),
  ]) {
    test('reads $code as $kind', () async {
      answers['ListMyCreatorStatements'] = () => refusal(code, status);

      await expectLater(
        repository().listStatements(creatorId: 'creator-1'),
        throwsA(
          isA<CreatorFailure>().having((error) => error.kind, 'kind', kind),
        ),
      );
    });
  }
}
