import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:publira/auth/account_confirmation.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/step_confirmation.dart';
import 'package:publira/forms/password_field.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Asks the reader to confirm a step that adds or takes away a way to sign
/// in, in a dialog titled [title]: with the account's password, which
/// [passwordDescription] asks for and [confirmLabel] sends, or, for an
/// account without one, with one of its passkeys or a fresh sign-in to a
/// linked provider this device offers.
///
/// Returns `null` where the reader closed the dialog or the provider's sheet.
///
/// Throws what [AccountConfirmation.read] throws, [PasskeyCancelled] or
/// [PasskeyFailure] from the passkey the reader confirmed with, and
/// [AuthFailure] from the API, [AuthFailureKind.unexpected] where the
/// provider's sign-in failed.
Future<StepConfirmation?> askStepConfirmation(
  BuildContext context, {
  required String title,
  required String passwordDescription,
  required String confirmLabel,
}) async {
  final auth = AuthScope.of(context);
  final signIn = ProviderSignInScope.maybeOf(context);
  final passkeys = PasskeyAuthenticatorScope.maybeOf(context);
  final account = await AccountConfirmation.read(auth, signIn, passkeys);
  if (!context.mounted) {
    return null;
  }
  final choice = await showDialog<_Choice>(
    context: context,
    builder: (context) => _StepConfirmationDialog(
      account: account,
      title: title,
      passwordDescription: passwordDescription,
      confirmLabel: confirmLabel,
    ),
  );
  switch (choice) {
    case null:
      return null;
    case _PasswordChoice(:final password):
      return ConfirmedByPassword(password);
    case _PasskeyChoice() when passkeys != null:
      return auth.confirmWithPasskey(passkeys);
    case _ProviderChoice(:final provider)
        when signIn != null && account.providers != null:
      try {
        return ConfirmedBySignIn(
          await signIn.signIn(provider, account.providers!),
        );
      } on ProviderSignInCancelled {
        return null;
      } on ProviderSignInFailure {
        throw const AuthFailure(AuthFailureKind.unexpected);
      }
    case _PasskeyChoice() || _ProviderChoice():
      return null;
  }
}

/// The words for a step the API refused because [confirmation] did not
/// verify, or `null` where [failure] is another refusal, which the step
/// words itself.
String? refusedConfirmationCopy(
  AppMessages messages,
  StepConfirmation confirmation,
  AuthFailure failure,
) {
  if (failure.kind != AuthFailureKind.invalidInput) {
    return null;
  }
  return switch (confirmation) {
    ConfirmedByPassword() => messages.stepConfirmationWrongPassword,
    ConfirmedByPasskey() => messages.passkeysConfirmFailed,
    ConfirmedBySignIn() => messages.stepConfirmationUnconfirmed,
  };
}

sealed class _Choice {
  const _Choice();
}

final class _PasswordChoice extends _Choice {
  const _PasswordChoice(this.password);

  final String password;
}

final class _PasskeyChoice extends _Choice {
  const _PasskeyChoice();
}

final class _ProviderChoice extends _Choice {
  const _ProviderChoice(this.provider);

  final IdentityProvider provider;
}

class _StepConfirmationDialog extends StatefulWidget {
  const _StepConfirmationDialog({
    required this.account,
    required this.title,
    required this.passwordDescription,
    required this.confirmLabel,
  });

  final AccountConfirmation account;
  final String title;
  final String passwordDescription;
  final String confirmLabel;

  @override
  State<_StepConfirmationDialog> createState() =>
      _StepConfirmationDialogState();
}

class _StepConfirmationDialogState extends State<_StepConfirmationDialog> {
  final _formKey = GlobalKey<FormState>();
  final _password = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  void _submitPassword() {
    if (_formKey.currentState?.validate() ?? false) {
      Navigator.of(context).pop(_PasswordChoice(_password.text));
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final account = widget.account;
    final cancel = TextButton(
      key: const ValueKey('step-confirmation-cancel'),
      onPressed: () => Navigator.of(context).pop(),
      child: AutospacedText(messages.commonCancel),
    );
    if (account.providers == null) {
      return AlertDialog(
        key: const ValueKey('step-confirmation'),
        title: AutospacedText(widget.title),
        content: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AutospacedText(widget.passwordDescription),
              const SizedBox(height: 16),
              PasswordField(
                key: const ValueKey('step-confirmation-password'),
                controller: _password,
                label: messages.stepConfirmationPasswordLabel,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                validator: (value) => (value ?? '').isEmpty
                    ? messages.authPasswordRequired
                    : null,
                onFieldSubmitted: (_) => _submitPassword(),
              ),
            ],
          ),
        ),
        actions: [
          cancel,
          FilledButton(
            key: const ValueKey('step-confirmation-submit'),
            onPressed: _submitPassword,
            child: AutospacedText(widget.confirmLabel),
          ),
        ],
      );
    }
    final offered = account.passkey || account.linked.isNotEmpty;
    return AlertDialog(
      key: const ValueKey('step-confirmation'),
      title: AutospacedText(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(
            offered
                ? messages.stepConfirmationWithoutPassword
                : messages.stepConfirmationNoMethod,
          ),
          if (account.passkey) ...[
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('step-confirmation-with-passkey'),
              onPressed: () =>
                  Navigator.of(context).pop(const _PasskeyChoice()),
              child: AutospacedText(messages.stepConfirmationWithPasskey),
            ),
          ],
          for (final provider in account.linked) ...[
            const SizedBox(height: 16),
            OutlinedButton(
              key: ValueKey('step-confirmation-with-${provider.name}'),
              onPressed: () =>
                  Navigator.of(context).pop(_ProviderChoice(provider)),
              child: AutospacedText(switch (provider) {
                IdentityProvider.apple => messages.stepConfirmationWithApple,
                IdentityProvider.google => messages.stepConfirmationWithGoogle,
              }),
            ),
          ],
        ],
      ),
      actions: [cancel],
    );
  }
}
