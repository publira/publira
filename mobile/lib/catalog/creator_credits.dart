import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

/// One run of neighbouring credits that name the same role.
class CreditGroup {
  const CreditGroup({required this.roleName, required this.credits});

  /// Empty on a credit written before the tenant curated any role, which is
  /// then the names on their own.
  final String roleName;
  final List<SeriesCreator> credits;
}

/// Collects [credits] into the runs a reader reads as one line of a colophon.
///
/// The runs are formed from neighbours rather than by gathering every credit
/// naming a role, so the order the API sent — the tenant's role priority —
/// survives.
List<CreditGroup> creditGroups(List<SeriesCreator> credits) {
  final groups = <CreditGroup>[];
  for (final credit in credits) {
    if (groups.isNotEmpty && groups.last.roleName == credit.roleName) {
      groups.last.credits.add(credit);
      continue;
    }
    groups.add(CreditGroup(roleName: credit.roleName, credits: [credit]));
  }
  return groups;
}

/// Who a work is credited to, written the way the site writes the same
/// credits: the role in [roleColor], the names in [nameColor].
///
/// Size, line count, and overflow come from [style] and the surrounding
/// [DefaultTextStyle], so one widget serves a card line and a title paragraph.
class CreatorCredits extends StatefulWidget {
  const CreatorCredits({
    super.key,
    required this.credits,
    this.style,
    this.roleColor,
    this.nameColor,
    this.maxLines,
    this.overflow,
    this.onCreatorTap,
  });

  final List<SeriesCreator> credits;
  final TextStyle? style;

  /// Defaults to the theme's muted colour.
  final Color? roleColor;

  /// Defaults to the theme's reading colour.
  final Color? nameColor;

  final int? maxLines;
  final TextOverflow? overflow;

  /// Makes every name a link, which is called with the credit it names.
  final ValueChanged<SeriesCreator>? onCreatorTap;

  @override
  State<CreatorCredits> createState() => _CreatorCreditsState();
}

class _CreatorCreditsState extends State<CreatorCredits> {
  /// One recognizer per creator named, kept for as long as the line is, since
  /// a recognizer made during a build would never be disposed.
  final _recognizers = <String, TapGestureRecognizer>{};

  @override
  void dispose() {
    for (final recognizer in _recognizers.values) {
      recognizer.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.credits.isEmpty) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    final colors = Theme.of(context).colorScheme;
    final muted = TextStyle(color: widget.roleColor ?? colors.onSurfaceVariant);
    final reading = TextStyle(color: widget.nameColor ?? colors.onSurface);
    final groups = creditGroups(widget.credits);
    return Text.rich(
      TextSpan(
        style: widget.style,
        children: [
          for (var index = 0; index < groups.length; index++) ...[
            if (index > 0) TextSpan(text: ' / ', style: muted),
            if (groups[index].roleName.isNotEmpty)
              TextSpan(text: '${groups[index].roleName} ', style: muted),
            ..._names(messages, groups[index].credits, reading),
          ],
        ],
      ),
      maxLines: widget.maxLines,
      overflow: widget.overflow,
    );
  }

  /// The names of one run, joined the way this locale joins a list.
  ///
  /// Without [CreatorCredits.onCreatorTap] that is one span. With it, each
  /// name is a span of its own so it can be a link: the list is formatted over
  /// one private-use character per name, and the characters are then replaced
  /// by the names, which leaves the locale's separators exactly where the
  /// catalog put them.
  List<InlineSpan> _names(
    AppMessages messages,
    List<SeriesCreator> credits,
    TextStyle style,
  ) {
    final onCreatorTap = widget.onCreatorTap;
    if (onCreatorTap == null) {
      return [
        TextSpan(
          text: messages.formatList([
            for (final credit in credits) credit.name,
          ]),
          style: style,
        ),
      ];
    }
    const firstMarker = 0xE000;
    final pattern = messages.formatList([
      for (var index = 0; index < credits.length; index++)
        String.fromCharCode(firstMarker + index),
    ]);
    final linked = style.copyWith(decoration: TextDecoration.underline);
    final spans = <InlineSpan>[];
    final between = StringBuffer();
    for (final unit in pattern.runes) {
      final index = unit - firstMarker;
      if (index < 0 || index >= credits.length) {
        between.writeCharCode(unit);
        continue;
      }
      if (between.isNotEmpty) {
        spans.add(TextSpan(text: between.toString(), style: style));
        between.clear();
      }
      final credit = credits[index];
      spans.add(
        TextSpan(
          text: credit.name,
          style: linked,
          recognizer: _recognizers.putIfAbsent(
            credit.id,
            () => TapGestureRecognizer(),
          )..onTap = () => onCreatorTap(credit),
        ),
      );
    }
    if (between.isNotEmpty) {
      spans.add(TextSpan(text: between.toString(), style: style));
    }
    return spans;
  }
}
