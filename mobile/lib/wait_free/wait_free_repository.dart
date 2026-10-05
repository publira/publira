import 'package:flutter/widgets.dart';
import 'package:publira/wait_free/wait_free_failure.dart';

/// An episode a wait-for-free ticket opened and that is still open.
class WaitFreeTicket {
  const WaitFreeTicket({required this.episodeId, required this.expiresAt});

  /// Internal id of the episode.
  final String episodeId;

  /// The instant the episode locks again.
  final DateTime expiresAt;
}

/// Where the signed-in reader stands with one series' wait-for-free rule.
class WaitFreeTicketState {
  const WaitFreeTicketState({
    this.nextAvailableAt,
    this.openTickets = const [],
  });

  /// When the reader's next ticket is ready, or `null` when one is ready now.
  final DateTime? nextAvailableAt;

  /// The reader's tickets on the series that still open their episode,
  /// soonest to close first.
  final List<WaitFreeTicket> openTickets;

  /// Whether the reader holds a ticket they can use at [now].
  ///
  /// The instant the API named may pass while the screen is open, which is
  /// when a countdown to it has reached zero.
  bool isReadyAt(DateTime now) => !(nextAvailableAt?.isAfter(now) ?? false);

  /// When the ticket on [episodeInternalId] closes it again, or `null` when no
  /// open ticket of this reader is on it.
  DateTime? expiryOf(String episodeInternalId) {
    for (final ticket in openTickets) {
      if (ticket.episodeId == episodeInternalId) {
        return ticket.expiresAt;
      }
    }
    return null;
  }
}

/// The signed-in reader's wait-for-free tickets, through
/// `publira.v1.WaitFreeService`.
///
/// Both calls need a session; a reader who holds none is answered
/// [WaitFreeFailureKind.sessionExpired] without a request.
abstract class WaitFreeRepository {
  /// Where the reader stands on the series [seriesInternalId].
  ///
  /// Throws [WaitFreeFailure]; [WaitFreeFailureKind.notOffered] for a series
  /// whose rule is off.
  Future<WaitFreeTicketState> ticketState(String seriesInternalId);

  /// Spends the reader's ticket on [episodeInternalId]'s series and opens the
  /// episode until the returned ticket expires. The episode then reads as
  /// entitled through an access ticket.
  ///
  /// Throws [WaitFreeFailure] for every refusal, none of which spends the
  /// ticket.
  Future<WaitFreeTicket> useTicket(String episodeInternalId);
}

/// Looks up the [WaitFreeRepository] installed by `PubliraApp`.
class WaitFreeScope extends InheritedWidget {
  const WaitFreeScope({super.key, this.repository, required super.child});

  final WaitFreeRepository? repository;

  /// `null` when this run offers no wait-for-free at all, which is what a
  /// widget test that does not care about it builds.
  static WaitFreeRepository? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<WaitFreeScope>()?.repository;

  @override
  bool updateShouldNotify(WaitFreeScope oldWidget) =>
      repository != oldWidget.repository;
}
