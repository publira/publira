import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// A fresh confirmation link for an address whose account was never
/// confirmed, through `AuthService/RequestEmailVerification`.
///
/// This is the way back for a reader whose first link expired or never
/// arrived: sign-in refuses an unconfirmed account, and signing up again
/// creates nothing. Every address is answered the same way, so the screen
/// reports that the request was taken rather than whether anything was sent.
class ResendVerificationScreen extends StatefulWidget {
  const ResendVerificationScreen({super.key, this.email});

  /// The address to start the field with, for a reader sent here from a form
  /// that already knows it. `null` leaves it empty.
  final String? email;

  @override
  State<ResendVerificationScreen> createState() =>
      _ResendVerificationScreenState();
}

class _ResendVerificationScreenState extends State<ResendVerificationScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _emailController = TextEditingController(text: widget.email ?? '');

  var _submitting = false;
  var _sent = false;

  /// Why the last attempt failed, rendered in the current locale on each
  /// build rather than as the copy of the locale it failed under.
  AuthFailureKind? _failure;

  @override
  void dispose() {
    _emailController.dispose();
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
      await auth.requestEmailVerification(_emailController.text.trim());
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
      _sent = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.resendVerificationTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _sent ? _buildSent(messages) : _buildForm(messages),
        ),
      ),
    );
  }

  Widget _buildSent(AppMessages messages) {
    return Column(
      key: const ValueKey('resend-verification-sent'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          messages.resendVerificationSentHeading,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(messages.authVerificationSent),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('resend-verification-sign-in'),
          onPressed: () => _openSignIn(),
          child: Text(messages.commonSignIn),
        ),
      ],
    );
  }

  Widget _buildForm(AppMessages messages) {
    final failure = _failure;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(messages.resendVerificationDescription),
          const SizedBox(height: 24),
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('resend-verification-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('resend-verification-email'),
            controller: _emailController,
            decoration: InputDecoration(
              labelText: messages.authEmailLabel,
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            textInputAction: TextInputAction.done,
            validator: (value) => validateAuthEmail(messages, value ?? ''),
            onFieldSubmitted: (_) => unawaited(_submit()),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('resend-verification-submit'),
            onPressed: _submitting ? null : () => unawaited(_submit()),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(messages.resendVerificationSubmit),
          ),
        ],
      ),
    );
  }

  /// The sign-in form, in place of this one, so the back gesture does not
  /// land on a request the reader has already made.
  void _openSignIn() {
    if (context.canPop()) {
      context.pushReplacement(AppRoutes.signIn);
    } else {
      context.go(AppRoutes.signIn);
    }
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.authResendFailed,
    };
  }
}
