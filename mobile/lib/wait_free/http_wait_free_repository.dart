import 'package:publira/api/client_surface.dart';
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

/// [WaitFreeRepository] backed by `publira.v1.WaitFreeService`.
class HttpWaitFreeRepository implements WaitFreeRepository {
  const HttpWaitFreeRepository({required this._client, required this._tenants});

  static const _stateProcedure = '/publira.v1.WaitFreeService/GetMyTicketState';
  static const _useProcedure = '/publira.v1.WaitFreeService/UseTicket';

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<WaitFreeTicketState> ticketState(String seriesInternalId) async {
    final body = await _call(_stateProcedure, {'seriesId': seriesInternalId});
    return WaitFreeTicketState(
      nextAvailableAt: _readInstant(body, 'nextAvailableAt'),
      openTickets: _tickets(body['openTickets']),
    );
  }

  @override
  Future<WaitFreeTicket> useTicket(String episodeInternalId) async {
    final body = await _call(_useProcedure, {'episodeId': episodeInternalId});
    final ticket = _ticket(body['ticket']);
    if (ticket == null) {
      throw const WaitFreeFailure(
        WaitFreeFailureKind.unexpected,
        message: 'ticket must name an episode and an expiry',
      );
    }
    return ticket;
  }

  /// Sends [fields] to [procedure] for the reader signed in now.
  ///
  /// The token is read once and sent explicitly, so the answer is about the
  /// reader who asked even when the account changes while the tenant lookup is
  /// in flight. A guest is answered without a request: the API needs a session
  /// for both calls.
  Future<Map<String, Object?>> _call(
    String procedure,
    Map<String, Object?> fields,
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
      return await _client.unary(
        procedure,
        {
          ...fields,
          'surface': appClientSurface,
          'tenant': {'tenantId': tenantId},
        },
        tenantId: tenantId,
        accessToken: accessToken,
      );
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  List<WaitFreeTicket> _tickets(Object? raw) {
    // protojson omits an empty repeated field.
    if (raw == null) {
      return const [];
    }
    if (raw is! List) {
      throw const WaitFreeFailure(
        WaitFreeFailureKind.unexpected,
        message: 'openTickets must be a list',
      );
    }
    return List.unmodifiable(raw.map(_ticket).nonNulls);
  }

  /// A ticket that names no episode or no expiry is one nothing could be
  /// timed against, so it is dropped.
  WaitFreeTicket? _ticket(Object? raw) {
    if (raw is! Map) {
      return null;
    }
    final json = raw.cast<String, Object?>();
    final episodeId = _readString(json, 'episodeId');
    final expiresAt = _readInstant(json, 'expiresAt');
    if (episodeId.isEmpty || expiresAt == null) {
      return null;
    }
    return WaitFreeTicket(episodeId: episodeId, expiresAt: expiresAt);
  }

  String _readString(Map<String, Object?> json, String key) {
    final value = json[key];
    return value is String ? value.trim() : '';
  }

  DateTime? _readInstant(Map<String, Object?> json, String key) =>
      DateTime.tryParse(_readString(json, key))?.toLocal();

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
