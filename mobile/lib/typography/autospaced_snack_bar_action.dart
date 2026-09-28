import 'package:flutter/material.dart';
import 'package:publira/typography/autospaced_text.dart';

/// [SnackBarAction] with its label set through [AutospacedText].
///
/// [SnackBar.action] takes only a [SnackBarAction], whose own state draws
/// [label] with a plain [Text], so this replaces the state and keeps what it
/// does: the action runs once, then closes the snack bar.
class AutospacedSnackBarAction extends SnackBarAction {
  const AutospacedSnackBarAction({
    super.key,
    required super.label,
    required super.onPressed,
  });

  @override
  State<SnackBarAction> createState() => _AutospacedSnackBarActionState();
}

class _AutospacedSnackBarActionState extends State<SnackBarAction> {
  var _triggered = false;

  void _handlePressed() {
    if (_triggered) {
      return;
    }
    setState(() {
      _triggered = true;
    });
    widget.onPressed();
    ScaffoldMessenger.of(
      context,
    ).hideCurrentSnackBar(reason: SnackBarClosedReason.action);
  }

  @override
  Widget build(BuildContext context) {
    final foreground =
        SnackBarTheme.of(context).actionTextColor ??
        Theme.of(context).colorScheme.inversePrimary;
    return TextButton(
      style: TextButton.styleFrom(
        foregroundColor: foreground,
        disabledForegroundColor: foreground,
        overlayColor: foreground,
      ),
      onPressed: _triggered ? null : _handlePressed,
      child: AutospacedText(widget.label),
    );
  }
}
