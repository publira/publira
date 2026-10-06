import 'package:flutter/material.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// A password input whose trailing eye button reveals what was typed and
/// masks it again, used by every form that asks for a password.
///
/// The button is named for what pressing it does — "Show password" while the
/// value is masked, "Hide password" while it is shown — so a screen reader
/// tells the reader the field's state in the same words the tooltip uses. The
/// tooltip stays out of the semantics tree, or the name would be read twice.
///
/// Every field starts masked, and each one is revealed on its own, so a form
/// with a confirmation field never shows a password the reader did not ask
/// to see.
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    required this.autofillHints,
    required this.textInputAction,
    required this.validator,
    this.onFieldSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final Iterable<String> autofillHints;
  final TextInputAction textInputAction;
  final FormFieldValidator<String> validator;
  final ValueChanged<String>? onFieldSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final toggleLabel = _revealed
        ? messages.authPasswordHide
        : messages.authPasswordShow;
    return TextFormField(
      controller: widget.controller,
      decoration: InputDecoration(
        label: AutospacedText(widget.label),
        border: const OutlineInputBorder(),
        suffixIcon: AutospacedTooltip(
          message: toggleLabel,
          excludeFromSemantics: true,
          child: IconButton(
            icon: Icon(
              _revealed
                  ? Icons.visibility_off_outlined
                  : Icons.visibility_outlined,
              semanticLabel: toggleLabel,
            ),
            onPressed: () => setState(() => _revealed = !_revealed),
          ),
        ),
      ),
      obscureText: !_revealed,
      // A revealed password is still a password: the keyboard must not learn
      // it or offer it back as a suggestion.
      autocorrect: false,
      enableSuggestions: false,
      autofillHints: widget.autofillHints,
      textInputAction: widget.textInputAction,
      errorBuilder: (context, error) => AutospacedText(error),
      validator: widget.validator,
      onFieldSubmitted: widget.onFieldSubmitted,
    );
  }
}
