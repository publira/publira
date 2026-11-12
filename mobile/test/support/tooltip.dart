import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// The [Tooltip] whose message is [message], whether or not it stays out of
/// the semantics tree.
///
/// [CommonFinders.byTooltip] reads the message off the semantics a tooltip
/// gives, and recognizes a tooltip that gives none only by the type of the
/// framework's own Material library, so it finds nothing for a `material_ui`
/// one built with `excludeFromSemantics`.
Finder findTooltip(String message) => find.byWidgetPredicate(
  (widget) =>
      widget is Tooltip &&
      (widget.message ?? widget.richMessage!.toPlainText()) == message,
  description: 'tooltip "$message"',
);
