import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/password_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Replaces the signed-in account's password through
/// `AuthService/ChangePassword`.
///
/// The change signs every other device out. This one keeps its session on the
/// token the API hands back.
///
/// An account a provider sign-in created has no password to give as the
/// current one, so the screen sends it to the password reset instead, which
/// sets a first password from the link it mails.
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

  /// Whether the account has a password, `null` until it has been read.
  _Password? _password;
  var _loadFailed = false;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  /// Reads whether the account has a password and, where it has none, the
  /// address the reset email is to go to.
  Future<void> _load() async {
    final auth = AuthScope.of(context);
    if (!auth.isSignedIn) {
      return;
    }
    if (_loadFailed) {
      setState(() {
        _loadFailed = false;
      });
    }
    _Password password;
    try {
      final identities = await auth.readLinkedIdentities();
      password = identities.hasPassword
          ? (exists: true, email: '')
          : (exists: false, email: await auth.readEmail() ?? '');
    } on Exception {
      if (mounted) {
        setState(() {
          _loadFailed = true;
        });
      }
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _password = password;
    });
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
        SnackBar(content: AutospacedText(messages.changePasswordChanged)),
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
    final password = _password;
    return Scaffold(
      appBar: AppBar(
        title: AutospacedText(
          password != null && !password.exists
              ? messages.changePasswordSetTitle
              : messages.changePasswordTitle,
        ),
      ),
      body: SafeArea(
        child: !signedIn
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: switch (password) {
                  _ when _loadFailed => _loadError(messages),
                  null => const Center(child: CircularProgressIndicator()),
                  (exists: true, email: _) => _form(messages),
                  (exists: false, :final email) => _setPassword(
                    messages,
                    email,
                  ),
                },
              ),
      ),
    );
  }

  Widget _loadError(AppMessages messages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(
          messages.changePasswordLoadFailed,
          key: const ValueKey('change-password-load-error'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('change-password-retry'),
          onPressed: () => unawaited(_load()),
          child: AutospacedText(messages.commonRetry),
        ),
      ],
    );
  }

  /// The way to a first password for an account that has none: the reset
  /// request form, with the account's address already in it.
  Widget _setPassword(AppMessages messages, String email) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(
          messages.changePasswordSetDescription,
          key: const ValueKey('change-password-set-description'),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('change-password-set-link'),
          onPressed: () =>
              context.pushInTab(AppRoutes.resetPasswordPath(email: email)),
          child: AutospacedText(messages.changePasswordSetLink),
        ),
      ],
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
            AutospacedText(
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
              label: AutospacedText(messages.changePasswordCurrentLabel),
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.next,
            errorBuilder: (context, error) => AutospacedText(error),
            validator: (value) => (value ?? '').trim().isEmpty
                ? messages.authPasswordRequired
                : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-password-new'),
            controller: _newController,
            decoration: InputDecoration(
              label: AutospacedText(messages.changePasswordNewLabel),
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.next,
            errorBuilder: (context, error) => AutospacedText(error),
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
              label: AutospacedText(messages.changePasswordNewConfirmLabel),
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textInputAction: TextInputAction.done,
            errorBuilder: (context, error) => AutospacedText(error),
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
                : AutospacedText(messages.changePasswordSubmit),
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

/// Whether the account has a password to change and, where it has none, the
/// address the reset email for a first one goes to.
typedef _Password = ({bool exists, String email});
