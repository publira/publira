import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// A [NavigationBar] destination whose label and tooltip are set through
/// [AutospacedText], which [NavigationDestination], taking them as strings,
/// cannot be.
///
/// The bar hands its own destinations their selection through a private
/// scope, so this one is told [selected], [onTap], and where it stands among
/// [count] destinations by the bar's owner. It draws what
/// [NavigationDestination] draws under the Material 3 defaults.
class AutospacedNavigationDestination extends StatefulWidget {
  const AutospacedNavigationDestination({
    super.key,
    required this.icon,
    this.selectedIcon,
    required this.label,
    this.tooltipMessage,
    required this.selected,
    required this.index,
    required this.count,
    required this.onTap,
  });

  final Widget icon;
  final Widget? selectedIcon;
  final String label;

  /// Shown on a long press in place of [label].
  final String? tooltipMessage;

  final bool selected;
  final int index;
  final int count;
  final VoidCallback onTap;

  @override
  State<AutospacedNavigationDestination> createState() =>
      _AutospacedNavigationDestinationState();
}

class _AutospacedNavigationDestinationState
    extends State<AutospacedNavigationDestination>
    with SingleTickerProviderStateMixin {
  final _iconKey = GlobalKey();

  late final _selection = AnimationController(
    vsync: this,
    // NavigationBar's own default.
    duration: const Duration(milliseconds: 500),
    value: widget.selected ? 1 : 0,
  );

  @override
  void didUpdateWidget(AutospacedNavigationDestination oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selected != oldWidget.selected) {
      if (widget.selected) {
        _selection.forward();
      } else {
        _selection.reverse();
      }
    }
  }

  @override
  void dispose() {
    _selection.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final theme = NavigationBarTheme.of(context);
    final states = {if (widget.selected) WidgetState.selected};
    final iconTheme =
        theme.iconTheme?.resolve(states) ??
        IconThemeData(
          size: 24,
          color: widget.selected
              ? colors.onSecondaryContainer
              : colors.onSurfaceVariant,
        );
    final labelStyle =
        theme.labelTextStyle?.resolve(states) ??
        Theme.of(context).textTheme.labelMedium!.apply(
          color: widget.selected ? colors.onSurface : colors.onSurfaceVariant,
        );
    final indicatorShape = theme.indicatorShape ?? const StadiumBorder();

    final destination = _IndicatorInkResponse(
      iconKey: _iconKey,
      customBorder: indicatorShape,
      overlayColor: theme.overlayColor,
      onTap: widget.onTap,
      child: CustomMultiChildLayout(
        delegate: _IconOverLabel(),
        children: [
          LayoutId(
            id: _IconOverLabel.icon,
            child: Stack(
              key: _iconKey,
              alignment: Alignment.center,
              children: [
                NavigationIndicator(
                  animation: _selection,
                  color: theme.indicatorColor ?? colors.secondaryContainer,
                  shape: indicatorShape,
                ),
                IconTheme.merge(
                  data: iconTheme,
                  child: widget.selected
                      ? widget.selectedIcon ?? widget.icon
                      : widget.icon,
                ),
              ],
            ),
          ),
          LayoutId(
            id: _IconOverLabel.label,
            child: Padding(
              padding: theme.labelPadding ?? const EdgeInsets.only(top: 4),
              child: MediaQuery.withClampedTextScaling(
                // NavigationBar's own ceiling, which keeps a large text scale
                // from outgrowing the bar.
                maxScaleFactor: 1.3,
                child: AutospacedText(widget.label, style: labelStyle),
              ),
            ),
          ),
        ],
      ),
    );

    final localizations = MaterialLocalizations.of(context);
    return Semantics(
      button: true,
      enabled: true,
      child: AutospacedTooltip(
        message: widget.tooltipMessage ?? widget.label,
        verticalOffset: 42,
        excludeFromSemantics: true,
        preferBelow: false,
        child: kIsWeb
            ? destination
            : Stack(
                alignment: Alignment.center,
                children: [
                  destination,
                  Semantics(
                    label: localizations.tabLabel(
                      tabIndex: widget.index + 1,
                      tabCount: widget.count,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

/// An ink response that splashes over the icon rather than the whole
/// destination, as [NavigationBar]'s does.
class _IndicatorInkResponse extends InkResponse {
  const _IndicatorInkResponse({
    required this.iconKey,
    super.customBorder,
    super.overlayColor,
    super.onTap,
    super.child,
  }) : super(containedInkWell: true, highlightColor: Colors.transparent);

  final GlobalKey iconKey;

  @override
  RectCallback? getRectCallback(RenderBox referenceBox) => () {
    final icon = iconKey.currentContext!.findRenderObject()! as RenderBox;
    final rect = icon.localToGlobal(Offset.zero) & icon.size;
    return referenceBox.globalToLocal(rect.topLeft) & icon.size;
  };
}

/// The icon over the label, the two centred as one in the destination and
/// free to overflow it, as [NavigationBar] lays out an always-shown label.
class _IconOverLabel extends MultiChildLayoutDelegate {
  static const icon = 'icon';
  static const label = 'label';

  @override
  void performLayout(Size size) {
    final iconSize = layoutChild(icon, BoxConstraints.loose(size));
    final labelSize = layoutChild(label, BoxConstraints.loose(size));
    final top = (size.height - iconSize.height - labelSize.height) / 2;
    positionChild(icon, Offset((size.width - iconSize.width) / 2, top));
    positionChild(
      label,
      Offset((size.width - labelSize.width) / 2, top + iconSize.height),
    );
  }

  @override
  bool shouldRelayout(_IconOverLabel oldDelegate) => false;
}
