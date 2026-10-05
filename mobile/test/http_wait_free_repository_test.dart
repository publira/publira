import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/wait_free/http_wait_free_repository.dart';
import 'package:publira/wait_free/wait_free_failure.dart';

import 'support/connect_fixture_server.dart';

void main() {
  const paidEpisodeId = ConnectFixtureServer.paidEpisodeId;
  final seriesInternalId = ConnectFixtureServer.internalIdOf(
    ConnectFixtureServer.seedSeriesId,
  );
  final episodeInternalId = ConnectFixtureServer.internalIdOf(paidEpisodeId);

  late ConnectFixtureServer server;
  late String accessToken;

  HttpWaitFreeRepository repository() {
    final client = ConnectClient(
      baseUrl: server.baseUrl,
      accessToken: () => accessToken,
    );
    return HttpWaitFreeRepository(
      client: client,
      tenants: TenantResolver(client: client, tenantHost: 'localhost'),
    );
  }

  Matcher failsWith(WaitFreeFailureKind kind) => throwsA(
    isA<WaitFreeFailure>().having((failure) => failure.kind, 'kind', kind),
  );

  setUp(() async {
    accessToken = ConnectFixtureServer.memberAccessToken;
    server = ConnectFixtureServer(
      details: ConnectFixtureServer.populatedDetails(),
      episodes: ConnectFixtureServer.populatedEpisodes(),
    );
    await server.start();
  });

  tearDown(() async {
    await server.close();
  });

  test('a ticket the API names no next instant for is ready now', () async {
    final state = await repository().ticketState(seriesInternalId);

    expect(state.nextAvailableAt, isNull);
    expect(state.openTickets, isEmpty);
    expect(state.isReadyAt(DateTime.now()), isTrue);
    final request = server.requestsTo('GetMyTicketState').single;
    expect(request.body['seriesId'], seriesInternalId);
    expect(request.body['surface'], 'CLIENT_SURFACE_APP');
    expect(request.headers['authorization'], 'Bearer $accessToken');
  });

  test('a ticket spent opens its episode until it expires', () async {
    final before = DateTime.now();

    final ticket = await repository().useTicket(episodeInternalId);

    expect(ticket.episodeId, episodeInternalId);
    expect(
      ticket.expiresAt.isAfter(before.add(const Duration(hours: 71))),
      isTrue,
    );
    expect(server.ticketsUsed, [paidEpisodeId]);
    expect(
      server.requestsTo('UseTicket').single.body['surface'],
      'CLIENT_SURFACE_APP',
    );

    final state = await repository().ticketState(seriesInternalId);
    expect(state.isReadyAt(DateTime.now()), isFalse);
    expect(state.expiryOf(episodeInternalId), ticket.expiresAt);
    expect(state.expiryOf('internal-another'), isNull);
  });

  test('an episode the reader can already open is refused as open', () async {
    await repository().useTicket(episodeInternalId);

    await expectLater(
      repository().useTicket(episodeInternalId),
      failsWith(WaitFreeFailureKind.alreadyOpen),
    );
  });

  test('each refusal of the rule is told apart by its reason', () async {
    const reasons = {
      'WAIT_FREE_NOT_OFFERED': WaitFreeFailureKind.notOffered,
      'WAIT_FREE_NOT_RECHARGED': WaitFreeFailureKind.notRecharged,
      'WAIT_FREE_EPISODE_EXCLUDED': WaitFreeFailureKind.excluded,
      'WAIT_FREE_EPISODE_FREE': WaitFreeFailureKind.episodeFree,
      'SOMETHING_NEW': WaitFreeFailureKind.unexpected,
    };
    for (final MapEntry(key: reason, value: kind) in reasons.entries) {
      server.waitFreeRefusal = reason;
      await expectLater(
        repository().useTicket(episodeInternalId),
        failsWith(kind),
        reason: reason,
      );
    }
    expect(server.ticketsUsed, isEmpty);
  });

  test('a guest is answered without a request', () async {
    accessToken = '';

    await expectLater(
      repository().ticketState(seriesInternalId),
      failsWith(WaitFreeFailureKind.sessionExpired),
    );
    await expectLater(
      repository().useTicket(episodeInternalId),
      failsWith(WaitFreeFailureKind.sessionExpired),
    );
    expect(server.requestsTo('GetMyTicketState'), isEmpty);
    expect(server.requestsTo('UseTicket'), isEmpty);
  });

  test('a session the API no longer takes has to sign in again', () async {
    accessToken = 'stale-token';

    await expectLater(
      repository().ticketState(seriesInternalId),
      failsWith(WaitFreeFailureKind.sessionExpired),
    );
  });
}
