import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/forms/password_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';

/// Where a password reset link lands: it takes a new password and spends the
/// link's token on it through `AuthService/ConfirmPasswordReset`.
///
/// The app claims the site's `/confirm-password` path, so a reader who opens
/// the link on a device carrying this build sets the password here rather
/// than in a browser. The API cannot tell whether a token is good without
/// spending it, so the form is offered for any token and a dead link is found
/// out on submit; a link without one is known to be dead before that.
class ConfirmPasswordScreen extends StatefulWidget {
  const ConfirmPasswordScreen({super.key, required this.token});

  /// The value the link's `token` query carries. Empty for a link that lost
  /// it.
  final String token;

  @override
  State<ConfirmPasswordScreen> createState() => _ConfirmPasswordScreenState();
}

class _ConfirmPasswordScreenState extends State<ConfirmPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  var _submitting = false;
  var _done = false;

  /// Why the last attempt failed, rendered in the current locale on each
  /// build rather than as the copy of the locale it failed under.
  late AuthFailureKind? _failure = widget.token.isEmpty
      ? AuthFailureKind.linkInvalid
      : null;

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
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
      await auth.confirmPasswordReset(
        token: widget.token,
        newPassword: _passwordController.text,
      );
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
      _done = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.confirmPasswordTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: _body(messages),
          ),
        ),
      ),
    );
  }

  List<Widget> _body(AppMessages messages) {
    if (_done) {
      return [
        Text(
          messages.confirmPasswordDone,
          key: const ValueKey('confirm-password-done'),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('confirm-password-sign-in'),
          onPressed: () => _leaveFor(AppRoutes.signIn),
          child: Text(messages.commonSignIn),
        ),
      ];
    }
    final failure = _failure;
    // A link that is dead stays dead however often it is submitted, so the
    // form gives way to the request for a new one.
    if (failure == AuthFailureKind.linkInvalid ||
        failure == AuthFailureKind.linkExpired) {
      return [
        Text(
          failure == AuthFailureKind.linkExpired
              ? messages.confirmPasswordExpired
              : messages.confirmPasswordInvalidToken,
          key: const ValueKey('confirm-password-link-error'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('confirm-password-request-again'),
          onPressed: () => _leaveFor(AppRoutes.resetPassword),
          child: Text(messages.confirmPasswordRequestAgain),
        ),
      ];
    }
    return [
      Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (failure != null) ...[
              Text(
                _failureCopy(messages, failure),
                key: const ValueKey('confirm-password-error'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              const SizedBox(height: 16),
            ],
            TextFormField(
              key: const ValueKey('confirm-password-password'),
              controller: _passwordController,
              decoration: InputDecoration(
                labelText: messages.confirmPasswordPasswordLabel,
                border: const OutlineInputBorder(),
              ),
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.next,
              validator: (value) => validateNewPassword(messages, value ?? ''),
            ),
            const SizedBox(height: 16),
            TextFormField(
              key: const ValueKey('confirm-password-password-confirm'),
              controller: _confirmController,
              decoration: InputDecoration(
                labelText: messages.confirmPasswordPasswordConfirmLabel,
                border: const OutlineInputBorder(),
              ),
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.done,
              validator: (value) => validatePasswordConfirmation(
                messages,
                value ?? '',
                password: _passwordController.text,
              ),
              onFieldSubmitted: (_) => unawaited(_submit()),
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const ValueKey('confirm-password-submit'),
              onPressed: _submitting ? null : () => unawaited(_submit()),
              child: _submitting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(messages.confirmPasswordSubmit),
            ),
          ],
        ),
      ),
    ];
  }

  /// Replaces this screen, so the back gesture does not return to a link
  /// that has been spent or is dead.
  void _leaveFor(String location) {
    if (context.canPop()) {
      context.pushReplacementInTab(location);
    } else {
      context.goInTab(location);
    }
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      _ => messages.confirmPasswordFailed,
    };
  }
}
