import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

/// [WaitFreeRepository] backed by `publira.v1.WaitFreeService`.
class HttpWaitFreeRepository implements WaitFreeRepository {
  const HttpWaitFreeRepository({required this._client, required this._tenants});

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<WaitFreeTicketState> ticketState(String seriesInternalId) async {
    final body = await _call(
      (api, call, tenant) => api.getMyTicketState(
        call,
        pb.GetMyTicketStateRequest(
          seriesId: seriesInternalId,
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
    return WaitFreeTicketState(
      nextAvailableAt: _readInstant(body.nextAvailableAt),
      openTickets: List.unmodifiable(body.openTickets.map(_ticket).nonNulls),
    );
  }

  @override
  Future<WaitFreeTicket> useTicket(String episodeInternalId) async {
    final body = await _call(
      (api, call, tenant) => api.useTicket(
        call,
        pb.UseTicketRequest(
          episodeId: episodeInternalId,
          surface: appClientSurface,
          tenant: tenant,
        ),
      ),
    );
    final ticket = _ticket(body.ticket);
    if (ticket == null) {
      throw const WaitFreeFailure(
        WaitFreeFailureKind.unexpected,
        message: 'ticket must name an episode and an expiry',
      );
    }
    return ticket;
  }

  /// Makes the call [send] makes through `api`, for the reader signed in now.
  ///
  /// The token is read once and sent explicitly, so the answer is about the
  /// reader who asked even when the account changes while the tenant lookup is
  /// in flight. A guest is answered without a request: the API needs a session
  /// for both calls.
  Future<T> _call<T>(
    Future<T> Function(
      pb.WaitFreeServiceApi api,
      ConnectCallContext call,
      pb.TenantContext tenant,
    )
    send,
  ) async {
    final accessToken = _client.accessToken;
    if (accessToken.isEmpty) {
      throw const WaitFreeFailure(
        WaitFreeFailureKind.sessionExpired,
        message: 'the app holds no session',
      );
    }
    try {
      final tenantId = await _tenants.resolve();
      return await send(
        pb.WaitFreeServiceApi(_client),
        ConnectCallContext(tenantId: tenantId, accessToken: accessToken),
        pb.TenantContext(tenantId: tenantId),
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  /// A ticket that names no episode or no expiry is one nothing could be
  /// timed against, so it is dropped.
  WaitFreeTicket? _ticket(pb.WaitFreeTicket ticket) {
    final episodeId = ticket.episodeId.trim();
    final expiresAt = _readInstant(ticket.expiresAt);
    if (episodeId.isEmpty || expiresAt == null) {
      return null;
    }
    return WaitFreeTicket(episodeId: episodeId, expiresAt: expiresAt);
  }

  DateTime? _readInstant(String value) =>
      DateTime.tryParse(value.trim())?.toLocal();

  WaitFreeFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return WaitFreeFailure(
        WaitFreeFailureKind.network,
        message: error.message,
      );
    }
    final kind = switch (error.code) {
      'unauthenticated' => WaitFreeFailureKind.sessionExpired,
      'already_exists' => WaitFreeFailureKind.alreadyOpen,
      'not_found' || 'permission_denied' => WaitFreeFailureKind.gone,
      'resource_exhausted' => WaitFreeFailureKind.tooManyRequests,
      'failed_precondition' => _preconditionKind(error.reasons),
      _ => WaitFreeFailureKind.unexpected,
    };
    return WaitFreeFailure(kind, message: error.message);
  }

  /// Which of the rule's refusals a `failed_precondition` is, by the reason
  /// the API names in its ErrorInfo.
  WaitFreeFailureKind _preconditionKind(List<String> reasons) {
    for (final reason in reasons) {
      switch (reason) {
        case waitFreeNotOfferedReason:
          return WaitFreeFailureKind.notOffered;
        case waitFreeNotRechargedReason:
          return WaitFreeFailureKind.notRecharged;
        case waitFreeEpisodeExcludedReason:
          return WaitFreeFailureKind.excluded;
        case waitFreeEpisodeFreeReason:
          return WaitFreeFailureKind.episodeFree;
      }
    }
    return WaitFreeFailureKind.unexpected;
  }
}
