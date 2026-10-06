import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The narrowest window the app lays out for a tablet rather than a phone,
/// which is where Material's medium window size class begins.
///
/// Every layout decision reads the window's width rather than the kind of
/// device: an iPad in split view and an unfolded foldable change width without
/// changing device, and a phone turned on its side is as wide as a small
/// tablet held upright.
const tabletWindowWidth = 600.0;

/// The height below which a window is short, where Material's compact height
/// class ends: a phone on its side, past [tabletWindowWidth] but with room for
/// little more than a toolbar and a few rows.
const compactWindowHeight = 480.0;

/// The widest a form or a column of prose is drawn. A line of body text past
/// it is too long to follow back to its start, and a field past it is far
/// wider than anything typed into it.
const readableWidth = 600.0;

/// Whether the window [context] is drawn in is laid out for a tablet.
bool isTabletWindow(BuildContext context) =>
    MediaQuery.sizeOf(context).width >= tabletWindowWidth;

/// How many columns a list in [context] is laid out in: [phone] in a phone's
/// window, and in a tablet's as many columns at least [minColumnWidth] wide as
/// the window holds, never fewer than one more than a phone shows.
///
/// The count is taken from the window rather than from the room left beside
/// the navigation rail, so a tablet at the breakpoint still gets its second
/// column. Each column then takes an even share of whatever width the list
/// has, which is what the tiles in it size themselves from.
///
/// The default is wide enough that a tablet shows the same count held either
/// way: the rows of a list scrolled part way down then hold the same items
/// once it is turned, so the reader is still looking at what they were.
int columnCount(
  BuildContext context, {
  int phone = 1,
  double minColumnWidth = 480,
}) {
  final width = MediaQuery.sizeOf(context).width;
  if (width < tabletWindowWidth) {
    return phone;
  }
  return math.max(phone + 1, width ~/ minColumnWidth);
}

/// How many rows [itemCount] items take, [columns] to a row.
int rowCount(int itemCount, int columns) =>
    (itemCount + columns - 1) ~/ columns;

/// Row [row] of a list laid out [columns] items to a row, each item an even
/// share of the row's width and [gap] apart.
///
/// A single column is the item itself, so a phone draws exactly the list it
/// drew before there were columns.
class ColumnRow extends StatelessWidget {
  const ColumnRow({
    super.key,
    required this.row,
    required this.columns,
    required this.itemCount,
    required this.itemBuilder,
    this.gap = 0,
  });

  final int row;
  final int columns;

  /// How many items the whole list holds, so the last row leaves the columns
  /// past its end empty.
  final int itemCount;

  final IndexedWidgetBuilder itemBuilder;
  final double gap;

  @override
  Widget build(BuildContext context) {
    if (columns == 1) {
      return itemBuilder(context, row);
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var column = 0; column < columns; column++) ...[
          if (column > 0 && gap > 0) SizedBox(width: gap),
          Expanded(
            child: row * columns + column < itemCount
                ? itemBuilder(context, row * columns + column)
                : const SizedBox.shrink(),
          ),
        ],
      ],
    );
  }
}

/// [padding] widened on both sides until what it holds is no wider than
/// [readableWidth] within [width], which centres that content.
///
/// For a scroll view, whose own padding is where this belongs: the scroll view
/// still spans the window, so a drag in the margin scrolls it.
EdgeInsets readablePadding(double width, EdgeInsets padding) {
  final inset = math.max(0.0, (width - padding.horizontal - readableWidth) / 2);
  return padding.copyWith(
    left: padding.left + inset,
    right: padding.right + inset,
  );
}

/// [child] no wider than [readableWidth], centred along the top of the room it
/// is given.
///
/// For the content inside a scroll view; a scroll view itself takes its
/// margins from [readablePadding] instead, so the margins scroll it too.
class ReadableWidth extends StatelessWidget {
  const ReadableWidth({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: readableWidth),
        child: child,
      ),
    );
  }
}

/// A scroll view built with [padding] widened by [readablePadding] for the
/// width it is given.
class ReadableScrollPadding extends StatelessWidget {
  const ReadableScrollPadding({
    super.key,
    this.padding = EdgeInsets.zero,
    required this.builder,
  });

  final EdgeInsets padding;
  final Widget Function(BuildContext context, EdgeInsets padding) builder;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) =>
          builder(context, readablePadding(constraints.maxWidth, padding)),
    );
  }
}
