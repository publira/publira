import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The end the API reports for a window a series' free-after-publication rule
/// opened. Such a window has no end of its own: it lasts for as long as the
/// rule covers the episode.
final _ruleFreeUntil = DateTime.utc(9999, 12, 31);

/// Says until when a free window keeps a priced episode free to read.
///
/// It is an absolute instant rather than a countdown: the window is days long
/// as a rule, and the day it closes is what a reader plans their reading by.
///
/// An episode the free-after-publication rule opened reads "Free", as one
/// priced at 0 does, because the date the API reports for it is in the year
/// 9999 and is no end a reader can wait for.
class FreeUntilBadge extends StatelessWidget {
  const FreeUntilBadge({super.key, required this.freeUntil});

  final DateTime freeUntil;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: AutospacedText(
          freeUntil.isAtSameMomentAs(_ruleFreeUntil)
              ? messages.commonFree
              : messages.commonFreeUntil(
                  date: messages.formatDateTimeWithWeekday(freeUntil),
                ),
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onTertiaryContainer,
          ),
        ),
      ),
    );
  }
}
