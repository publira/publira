import 'package:flutter/material.dart';
import 'package:publira/typography/autospaced_text.dart';

/// [Tooltip] with its message spaced the way [AutospacedText] spaces text,
/// for the tooltips a `tooltip:` string would otherwise draw unspaced.
class AutospacedTooltip extends StatelessWidget {
  const AutospacedTooltip({
    super.key,
    required this.message,
    this.verticalOffset,
    this.preferBelow,
    this.excludeFromSemantics,
    required this.child,
  });

  final String message;
  final double? verticalOffset;
  final bool? preferBelow;
  final bool? excludeFromSemantics;
  final Widget child;

  @override
  Widget build(BuildContext context) => Tooltip(
    richMessage: autospaceIn(
      context,
      TextSpan(text: message),
      style: _tooltipTextStyle(context),
    ),
    verticalOffset: verticalOffset,
    preferBelow: preferBelow,
    excludeFromSemantics: excludeFromSemantics,
    child: child,
  );
}

/// The style [Tooltip] sets a message in when the theme gives none, which the
/// gap is sized from.
TextStyle _tooltipTextStyle(BuildContext context) {
  final theme = Theme.of(context);
  final themed = TooltipTheme.of(context).textStyle;
  if (themed != null) {
    return themed;
  }
  return theme.textTheme.bodyMedium!.copyWith(
    fontSize: switch (theme.platform) {
      TargetPlatform.macOS ||
      TargetPlatform.linux ||
      TargetPlatform.windows => 12,
      TargetPlatform.android ||
      TargetPlatform.fuchsia ||
      TargetPlatform.iOS => 14,
    },
  );
}
