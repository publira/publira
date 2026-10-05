import 'dart:async';

import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

/// In-memory [WaitFreeRepository] for widget tests.
class FakeWaitFreeRepository implements WaitFreeRepository {
  FakeWaitFreeRepository({
    this.state = const WaitFreeTicketState(),
    this.ticketAccess = const Duration(hours: 72),
  });

  /// What [ticketState] answers, whichever series is asked about.
  WaitFreeTicketState state;

  /// Thrown by [ticketState].
  WaitFreeFailure? stateFailure;

  /// How long a ticket [useTicket] spends opens its episode for.
  Duration ticketAccess;

  /// Thrown by [useTicket], which then spends nothing.
  WaitFreeFailure? useFailure;

  /// Held open by a test that needs a [useTicket] in flight.
  Completer<void>? useGate;

  /// Called for a ticket [useTicket] spent, which is when the API starts
  /// answering the episode as the reader's.
  void Function(String episodeInternalId)? onUsed;

  /// Series [ticketState] was asked about, in order.
  final List<String> stateReads = <String>[];

  /// Episodes [useTicket] spent a ticket on, in order.
  final List<String> used = <String>[];

  @override
  Future<WaitFreeTicketState> ticketState(String seriesInternalId) async {
    stateReads.add(seriesInternalId);
    if (stateFailure case final failure?) {
      throw failure;
    }
    return state;
  }

  @override
  Future<WaitFreeTicket> useTicket(String episodeInternalId) async {
    await useGate?.future;
    if (useFailure case final failure?) {
      throw failure;
    }
    final now = DateTime.now();
    final ticket = WaitFreeTicket(
      episodeId: episodeInternalId,
      expiresAt: now.add(ticketAccess),
    );
    used.add(episodeInternalId);
    state = WaitFreeTicketState(
      nextAvailableAt: now.add(const Duration(hours: 23)),
      openTickets: [ticket, ...state.openTickets],
    );
    onUsed?.call(episodeInternalId);
    return ticket;
  }
}
