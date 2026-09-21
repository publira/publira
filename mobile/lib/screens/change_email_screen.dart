import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// Asks to move the signed-in account to another address through
/// `AuthService/RequestEmailChange`.
///
/// The API mails a link to the current address and one to the new one, and
/// the account keeps the current address until both have been opened, so the
/// screen ends on saying so rather than on a changed address.
class ChangeEmailScreen extends StatefulWidget {
  const ChangeEmailScreen({super.key});

  @override
  State<ChangeEmailScreen> createState() => _ChangeEmailScreenState();
}

class _ChangeEmailScreenState extends State<ChangeEmailScreen> {
  final _formKey = GlobalKey<FormState>();
  final _newEmailController = TextEditingController();
  final _passwordController = TextEditingController();

  /// The address the account holds, read when the screen opens because the
  /// session does not carry it and the API asks for it back.
  late Future<String?> _currentEmail;
  var _started = false;
  var _submitting = false;
  var _requested = false;
  AuthFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _currentEmail = AuthScope.of(context).readEmail();
  }

  @override
  void dispose() {
    _newEmailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _currentEmail = AuthScope.of(context).readEmail();
    });
  }

  Future<void> _submit(String currentEmail) async {
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
      await auth.requestEmailChange(
        currentEmail: currentEmail,
        newEmail: _newEmailController.text.trim(),
        currentPassword: _passwordController.text,
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
      _requested = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(title: Text(messages.changeEmailTitle)),
      body: SafeArea(
        child: !signedIn && !_requested
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: FutureBuilder<String?>(
                  future: _currentEmail,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(
                        key: ValueKey('change-email-loading'),
                        child: CircularProgressIndicator(),
                      );
                    }
                    final currentEmail = snapshot.data;
                    if (snapshot.hasError || currentEmail == null) {
                      return _loadFailed(messages);
                    }
                    if (_requested) {
                      return Text(
                        messages.changeEmailRequested,
                        key: const ValueKey('change-email-requested'),
                      );
                    }
                    return _form(messages, currentEmail);
                  },
                ),
              ),
      ),
    );
  }

  Widget _loadFailed(AppMessages messages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          messages.changeEmailLoadFailed,
          key: const ValueKey('change-email-load-error'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('change-email-reload'),
          onPressed: _reload,
          child: Text(messages.commonRetry),
        ),
      ],
    );
  }

  Widget _form(AppMessages messages, String currentEmail) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('change-email-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          InputDecorator(
            decoration: InputDecoration(
              labelText: messages.changeEmailCurrentLabel,
              border: const OutlineInputBorder(),
            ),
            child: Text(
              currentEmail,
              key: const ValueKey('change-email-current'),
            ),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-email-new'),
            controller: _newEmailController,
            decoration: InputDecoration(
              labelText: messages.changeEmailNewLabel,
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            textInputAction: TextInputAction.next,
            validator: (value) {
              final email = value ?? '';
              final invalid = validateAuthEmail(messages, email);
              if (invalid != null) {
                return invalid;
              }
              // The API compares addresses without regard to case, and
              // refuses the one the account already holds.
              if (email.trim().toLowerCase() == currentEmail.toLowerCase()) {
                return messages.changeEmailSameEmail;
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-email-password'),
            controller: _passwordController,
            decoration: InputDecoration(
              labelText: messages.changeEmailPasswordLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            validator: (value) => (value ?? '').trim().isEmpty
                ? messages.authPasswordRequired
                : null,
            onFieldSubmitted: (_) => unawaited(_submit(currentEmail)),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('change-email-submit'),
            onPressed: _submitting
                ? null
                : () => unawaited(_submit(currentEmail)),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(messages.changeEmailSubmit),
          ),
        ],
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.changeEmailFailed,
    };
  }
}
