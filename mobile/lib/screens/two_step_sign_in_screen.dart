import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/two_step_verification.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/sign_in_screen.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The code a sign-in to an account that holds an authenticator asks for
/// after the password, or after an Apple or Google sign-in, sent with the
/// [challenge] that sign-in answered to `AuthService/VerifyMfa`.
///
/// **Use a recovery code** takes one of the codes handed out when the
/// authenticator was set up instead. A wrong code and the lock that follows
/// too many of them stay on the form; a challenge the API no longer takes
/// sends the reader back to sign in. A passkey sign-in never comes here: it
/// is already two factors.
class TwoStepSignInScreen extends StatefulWidget {
  const TwoStepSignInScreen({super.key, this.challenge, this.returnTo});

  /// What the sign-in answered, `null` when the screen was reached without
  /// one, which only a fresh sign-in can replace.
  final MfaChallenge? challenge;

  /// Where the reader lands once signed in.
  final String? returnTo;

  @override
  State<TwoStepSignInScreen> createState() => _TwoStepSignInScreenState();
}

class _TwoStepSignInScreenState extends State<TwoStepSignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();

  var _recovery = false;
  var _submitting = false;

  /// Why the last code did not sign the reader in, `null` while none has
  /// failed.
  AuthFailureKind? _failure;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  bool get _expired {
    final challenge = widget.challenge;
    return challenge == null ||
        challenge.hasExpired(DateTime.now()) ||
        _failure == AuthFailureKind.sessionExpired;
  }

  void _switchMethod() {
    setState(() {
      _recovery = !_recovery;
      _failure = null;
      _codeController.clear();
    });
  }

  Future<void> _submit(MfaChallenge challenge) async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    try {
      await auth.verifyMfa(challenge, _codeController.text.trim());
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    if (failure == null) {
      leaveSignIn(context, widget.returnTo);
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
    });
  }

  void _startAgain() {
    context.pushReplacementInTab(
      AppRoutes.signInPath(returnTo: widget.returnTo),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final challenge = widget.challenge;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.twoStepTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ReadableWidth(
            child: challenge == null || _expired
                ? _buildExpired(messages)
                : _buildForm(messages, challenge),
          ),
        ),
      ),
    );
  }

  Widget _buildExpired(AppMessages messages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(
          messages.twoStepExpired,
          key: const ValueKey('two-step-expired'),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('two-step-start-again'),
          onPressed: _startAgain,
          child: AutospacedText(messages.commonSignIn),
        ),
      ],
    );
  }

  Widget _buildForm(AppMessages messages, MfaChallenge challenge) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(
            _recovery
                ? messages.twoStepRecoveryDescription
                : messages.twoStepDescription,
          ),
          const SizedBox(height: 24),
          if (failure != null) ...[
            AutospacedText(
              _failureCopy(messages, failure),
              key: const ValueKey('two-step-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          TwoStepCodeField(
            key: const ValueKey('two-step-code'),
            controller: _codeController,
            label: _recovery
                ? messages.twoStepRecoveryCodeLabel
                : messages.twoStepCodeLabel,
            authenticatorOnly: !_recovery,
            autofocus: true,
            onSubmitted: () => unawaited(_submit(challenge)),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('two-step-submit'),
            onPressed: _submitting ? null : () => unawaited(_submit(challenge)),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : AutospacedText(messages.twoStepSubmit),
          ),
          const SizedBox(height: 8),
          TextButton(
            key: const ValueKey('two-step-switch-method'),
            onPressed: _submitting ? null : _switchMethod,
            child: AutospacedText(
              _recovery
                  ? messages.twoStepUseAuthenticator
                  : messages.twoStepUseRecoveryCode,
            ),
          ),
        ],
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.mfaInvalidCode =>
        _recovery
            ? messages.twoStepInvalidRecoveryCode
            : messages.twoStepInvalidCode,
      AuthFailureKind.mfaLocked => messages.twoStepLocked,
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.signInFailed,
    };
  }
}

/// The one field a two-step verification code is typed into: on the code
/// step, and on every form of the account's two-step verification that asks
/// for one.
///
/// [authenticatorOnly] is where only the authenticator's six digits are
/// taken, which brings up the number pad; a recovery code carries letters and
/// a separator, so a field that takes one keeps the full keyboard.
class TwoStepCodeField extends StatelessWidget {
  const TwoStepCodeField({
    super.key,
    required this.controller,
    required this.label,
    required this.authenticatorOnly,
    this.help,
    this.autofocus = false,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final bool authenticatorOnly;
  final String? help;
  final bool autofocus;
  final VoidCallback? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final helper = help;
    return TextFormField(
      controller: controller,
      autofocus: autofocus,
      decoration: InputDecoration(
        label: AutospacedText(label),
        helper: helper == null ? null : AutospacedText(helper),
        border: const OutlineInputBorder(),
      ),
      keyboardType: authenticatorOnly
          ? TextInputType.number
          : TextInputType.visiblePassword,
      inputFormatters: authenticatorOnly
          ? [FilteringTextInputFormatter.digitsOnly]
          : null,
      autocorrect: false,
      enableSuggestions: false,
      autofillHints: const [AutofillHints.oneTimeCode],
      textInputAction: TextInputAction.done,
      errorBuilder: (context, error) => AutospacedText(error),
      validator: (value) =>
          (value ?? '').trim().isEmpty ? messages.twoStepCodeRequired : null,
      onFieldSubmitted: (_) => onSubmitted?.call(),
    );
  }
}
