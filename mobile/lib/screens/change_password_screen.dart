import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/password_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// Replaces the signed-in account's password through
/// `AuthService/ChangePassword`.
///
/// The change signs every other device out. This one keeps its session on the
/// token the API hands back.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();

  var _submitting = false;
  AuthFailureKind? _failure;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    try {
      await auth.changePassword(
        currentPassword: _currentController.text,
        newPassword: _newController.text,
      );
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    if (failure == null) {
      messenger.showSnackBar(
        SnackBar(content: Text(messages.changePasswordChanged)),
      );
      leaveAccountSettings(context);
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(title: Text(messages.changePasswordTitle)),
      body: SafeArea(
        child: !signedIn
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: _form(messages),
              ),
      ),
    );
  }

  Widget _form(AppMessages messages) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('change-password-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('change-password-current'),
            controller: _currentController,
            decoration: InputDecoration(
              labelText: messages.changePasswordCurrentLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.next,
            validator: (value) => (value ?? '').trim().isEmpty
                ? messages.authPasswordRequired
                : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-password-new'),
            controller: _newController,
            decoration: InputDecoration(
              labelText: messages.changePasswordNewLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.next,
            validator: (value) {
              final password = value ?? '';
              final invalid = validateNewPassword(messages, password);
              if (invalid != null) {
                return invalid;
              }
              // The API refuses this too, on a field this screen does not
              // read, so the reason is given before the request is sent.
              if (password.trim() == _currentController.text.trim()) {
                return messages.changePasswordUnchanged;
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-password-confirm'),
            controller: _confirmController,
            decoration: InputDecoration(
              labelText: messages.changePasswordNewConfirmLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.done,
            validator: (value) => validatePasswordConfirmation(
              messages,
              value ?? '',
              password: _newController.text,
            ),
            onFieldSubmitted: (_) => unawaited(_submit()),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('change-password-submit'),
            onPressed: _submitting ? null : () => unawaited(_submit()),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(messages.changePasswordSubmit),
          ),
        ],
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.changePasswordFailed,
    };
  }
}
