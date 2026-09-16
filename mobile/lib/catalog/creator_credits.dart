import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';

/// One run of neighbouring credits that name the same role.
class CreditGroup {
  const CreditGroup({required this.roleName, required this.names});

  /// Empty on a credit written before the tenant curated any role, which is
  /// then the names on their own.
  final String roleName;
  final List<String> names;
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
      groups.last.names.add(credit.name);
      continue;
    }
    groups.add(CreditGroup(roleName: credit.roleName, names: [credit.name]));
  }
  return groups;
}

/// Who a work is credited to, written the way the site writes the same
/// credits: the role in [roleColor], the names in [nameColor].
///
/// Size, line count, and overflow come from [style] and the surrounding
/// [DefaultTextStyle], so one widget serves a card line and a title paragraph.
class CreatorCredits extends StatelessWidget {
  const CreatorCredits({
    super.key,
    required this.credits,
    this.style,
    this.roleColor,
    this.nameColor,
    this.maxLines,
    this.overflow,
  });

  final List<SeriesCreator> credits;
  final TextStyle? style;

  /// Defaults to the theme's muted colour.
  final Color? roleColor;

  /// Defaults to the theme's reading colour.
  final Color? nameColor;

  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    if (credits.isEmpty) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    final colors = Theme.of(context).colorScheme;
    final muted = TextStyle(color: roleColor ?? colors.onSurfaceVariant);
    final reading = TextStyle(color: nameColor ?? colors.onSurface);
    final groups = creditGroups(credits);
    return Text.rich(
      TextSpan(
        style: style,
        children: [
          for (var index = 0; index < groups.length; index++) ...[
            if (index > 0) TextSpan(text: ' / ', style: muted),
            if (groups[index].roleName.isNotEmpty)
              TextSpan(text: '${groups[index].roleName} ', style: muted),
            TextSpan(
              text: messages.formatList(groups[index].names),
              style: reading,
            ),
          ],
        ],
      ),
      maxLines: maxLines,
      overflow: overflow,
    );
  }
}
