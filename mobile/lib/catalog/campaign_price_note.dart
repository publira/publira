import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What stands beside a campaign price wherever the app quotes one: the
/// regular price struck through, and until when the campaign lasts.
///
/// The regular price stays on screen because the campaign is only worth
/// something against it, and it is what the episode costs again afterwards.
/// Strike-through is not announced by a screen reader, so the regular price
/// carries its name in words for one. The end is an absolute instant, for the
/// reason `FreeUntilBadge` gives.
class CampaignPriceNote extends StatelessWidget {
  const CampaignPriceNote({
    super.key,
    required this.price,
    required this.currency,
    required this.endsAt,
    this.color,
    this.alignment = WrapAlignment.start,
  });

  /// The episode's regular price, in the minor unit of [currency].
  final int price;

  /// The ISO 4217 code of the currency [price] is in, the tenant's.
  final String currency;

  final DateTime endsAt;

  /// The colour of the struck-through price, where the ambient text colour is
  /// not the one it should take.
  final Color? color;

  final WrapAlignment alignment;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final regular = messages.formatPrice(price, currency);
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      alignment: alignment,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        AutospacedText(
          regular,
          semanticsLabel: messages.commonRegularPrice(price: regular),
          style: TextStyle(
            color: color,
            decoration: TextDecoration.lineThrough,
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: theme.colorScheme.secondaryContainer,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            child: AutospacedText(
              messages.commonCampaignUntil(
                date: messages.formatDateTimeWithWeekday(endsAt),
              ),
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSecondaryContainer,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
