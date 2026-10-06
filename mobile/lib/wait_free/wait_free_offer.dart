import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/wait_free/wait_free_failure.dart';
import 'package:publira/wait_free/wait_free_repository.dart';

/// What a locked episode's gate says about wait-for-free, in the five states
/// it can be in.
sealed class WaitFreeOffer {
  const WaitFreeOffer();
}

/// One of the latest episodes, which the rule keeps a ticket off.
final class WaitFreeExcluded extends WaitFreeOffer {
  const WaitFreeExcluded();
}

/// A guest, who has to sign in before a ticket is theirs to use.
final class WaitFreeGuest extends WaitFreeOffer {
  const WaitFreeGuest();
}

/// The reader's ticket is ready, and opens the episode for [accessHours].
final class WaitFreeReady extends WaitFreeOffer {
  const WaitFreeReady({required this.accessHours});

  final int accessHours;
}

/// The reader used their ticket, and the next one is ready at
/// [nextAvailableAt].
final class WaitFreeRecharging extends WaitFreeOffer {
  const WaitFreeRecharging({required this.nextAvailableAt});

  final DateTime nextAvailableAt;
}

/// The reader's ticket state could not be read.
final class WaitFreeUnavailable extends WaitFreeOffer {
  const WaitFreeUnavailable();
}

/// The offer for [detail], or `null` when there is none to make: the episode
/// is not locked, or its series offers no wait-for-free.
///
/// The rule comes from the series read, since the episode read does not carry
/// it, and the reader's standing from [waitFree] — asked only of a signed-in
/// reader on an episode a ticket may open, because neither a guest nor an
/// excluded episode has a ticket to count down to.
///
/// A series that cannot be read offers nothing rather than an error: the gate
/// still says why the body is closed and how to buy it. A rule the API says is
/// off, or a series it no longer shows, offers nothing either: the series read
/// was older than that answer.
Future<WaitFreeOffer?> readWaitFreeOffer({
  required CatalogRepository catalog,
  required WaitFreeRepository waitFree,
  required EpisodeDetail detail,
  required bool signedIn,
  DateTime Function() now = DateTime.now,
}) async {
  if (detail.access != EpisodeAccess.locked) {
    return null;
  }
  final SeriesDetail? series;
  try {
    series = await catalog.getSeries(detail.seriesId);
  } on CatalogFailure {
    return null;
  }
  final rule = series?.waitFree;
  if (series == null || rule == null) {
    return null;
  }
  if (!rule.covers(detail.episode.internalId)) {
    return const WaitFreeExcluded();
  }
  if (!signedIn) {
    return const WaitFreeGuest();
  }
  try {
    final state = await waitFree.ticketState(series.series.internalId);
    final nextAvailableAt = state.nextAvailableAt;
    return nextAvailableAt == null || state.isReadyAt(now())
        ? WaitFreeReady(accessHours: rule.accessHours)
        : WaitFreeRecharging(nextAvailableAt: nextAvailableAt);
  } on WaitFreeFailure catch (failure) {
    return switch (failure.kind) {
      WaitFreeFailureKind.notOffered || WaitFreeFailureKind.gone => null,
      _ => const WaitFreeUnavailable(),
    };
  }
}

/// [remaining] as a clock counting down, hours, minutes, and seconds:
/// `22:41:05`. The hours run on past a day rather than turning into one.
///
/// Digits and colons read the same in every locale the app ships, and a clock
/// needs no unit word, whose plural form the catalog has no way to select.
String formatCountdown(Duration remaining) {
  final seconds = remaining.isNegative ? 0 : remaining.inSeconds;
  String twoDigits(int value) => value.toString().padLeft(2, '0');
  return '${seconds ~/ 3600}:${twoDigits(seconds ~/ 60 % 60)}:'
      '${twoDigits(seconds % 60)}';
}

/// The sentence a locked episode's gate says about [offer], under why the
/// body is closed.
///
/// While the next ticket recharges it counts down to it once a second, and
/// calls [onRecharged] once it is ready, so the gate can read the reader's
/// standing again and offer the ticket.
class WaitFreeNotice extends StatefulWidget {
  const WaitFreeNotice({
    super.key,
    required this.offer,
    required this.onRecharged,
    this.now = DateTime.now,
  });

  final WaitFreeOffer offer;
  final VoidCallback onRecharged;

  /// The clock the countdown reads, which a test replaces.
  final DateTime Function() now;

  @override
  State<WaitFreeNotice> createState() => _WaitFreeNoticeState();
}

class _WaitFreeNoticeState extends State<WaitFreeNotice> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _startTicking();
  }

  @override
  void didUpdateWidget(WaitFreeNotice oldWidget) {
    super.didUpdateWidget(oldWidget);
    _ticker?.cancel();
    _startTicking();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  /// Ticks once a second while there is a countdown to draw. Each tick reads
  /// the clock rather than counting itself, so a countdown the system paused
  /// in the background is right the moment it is back.
  void _startTicking() {
    final offer = widget.offer;
    if (offer is! WaitFreeRecharging) {
      _ticker = null;
      return;
    }
    _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!offer.nextAvailableAt.isAfter(widget.now())) {
        timer.cancel();
        widget.onRecharged();
        return;
      }
      setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final (key, text) = switch (widget.offer) {
      WaitFreeExcluded() => (
        'wait-free-excluded',
        messages.viewerWaitFreeExcluded,
      ),
      WaitFreeGuest() => ('wait-free-guest', messages.viewerWaitFreeGuest),
      WaitFreeReady(:final accessHours) => (
        'wait-free-ready',
        messages.viewerWaitFreeReady(
          date: messages.formatDateTimeWithWeekday(
            widget.now().add(Duration(hours: accessHours)),
          ),
        ),
      ),
      WaitFreeRecharging(:final nextAvailableAt) => (
        'wait-free-recharging',
        messages.viewerWaitFreeRecharging(
          time: formatCountdown(nextAvailableAt.difference(widget.now())),
        ),
      ),
      WaitFreeUnavailable() => (
        'wait-free-unavailable',
        messages.viewerWaitFreeStateFailed,
      ),
    };
    final theme = Theme.of(context);
    return AutospacedText(
      key: ValueKey(key),
      text,
      textAlign: TextAlign.center,
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.onSurface,
      ),
    );
  }
}

/// "Read free with a ticket": spends the reader's ready ticket on one episode.
///
/// It calls [onOpened] once the API has opened the episode. A refusal the gate
/// words itself — the episode already open or free, the ticket not ready, the
/// episode excluded, the rule off — calls [onRefused], since what the gate
/// says next has to be read again. Only a failure nobody can word from the
/// reader's standing is said here.
class UseWaitFreeTicketButton extends StatefulWidget {
  const UseWaitFreeTicketButton({
    super.key,
    required this.episodeInternalId,
    required this.onOpened,
    required this.onRefused,
  });

  final String episodeInternalId;
  final VoidCallback onOpened;
  final VoidCallback onRefused;

  @override
  State<UseWaitFreeTicketButton> createState() =>
      _UseWaitFreeTicketButtonState();
}

class _UseWaitFreeTicketButtonState extends State<UseWaitFreeTicketButton> {
  var _using = false;

  Future<void> _use() async {
    final waitFree = WaitFreeScope.maybeOf(context);
    if (waitFree == null || _using) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _using = true;
    });
    try {
      await waitFree.useTicket(widget.episodeInternalId);
      if (mounted) {
        widget.onOpened();
      }
    } on WaitFreeFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        case WaitFreeFailureKind.alreadyOpen ||
            WaitFreeFailureKind.episodeFree ||
            WaitFreeFailureKind.notRecharged ||
            WaitFreeFailureKind.excluded ||
            WaitFreeFailureKind.notOffered ||
            WaitFreeFailureKind.gone:
          widget.onRefused();
        case WaitFreeFailureKind.sessionExpired:
          messenger.showSnackBar(
            SnackBar(
              content: AutospacedText(messages.errorsRpcUnauthenticated),
            ),
          );
        case WaitFreeFailureKind.network:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.errorsRpcUnavailable)),
          );
        case WaitFreeFailureKind.tooManyRequests ||
            WaitFreeFailureKind.unexpected:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.viewerWaitFreeUseFailed)),
          );
      }
    } finally {
      if (mounted) {
        setState(() {
          _using = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      key: const ValueKey('episode-wait-free-use'),
      onPressed: _using ? null : () => unawaited(_use()),
      child: AutospacedText(AppMessages.of(context).viewerWaitFreeUse),
    );
  }
}
