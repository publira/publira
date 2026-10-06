import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/account_confirmation.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/forms/password_field.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Asks to move the signed-in account to another address through
/// `AuthService/RequestEmailChange`.
///
/// The request is confirmed with the account's password, or, for an account
/// without one, with a fresh sign-in to a provider linked to it. The API mails
/// a link to the current address and one to the new one, and the account
/// keeps the current address until both have been opened, so the screen ends
/// on saying so rather than on a changed address.
class ChangeEmailScreen extends StatefulWidget {
  const ChangeEmailScreen({super.key});

  @override
  State<ChangeEmailScreen> createState() => _ChangeEmailScreenState();
}

/// The address the account holds and how it confirms the change, read when
/// the screen opens: the session carries neither, and the API asks for the
/// address back.
typedef _Account = ({String email, AccountConfirmation confirmation});

class _ChangeEmailScreenState extends State<ChangeEmailScreen> {
  final _formKey = GlobalKey<FormState>();
  final _newEmailController = TextEditingController();
  final _passwordController = TextEditingController();

  late Future<_Account?> _account;
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
    _account = _read();
  }

  @override
  void dispose() {
    _newEmailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<_Account?> _read() async {
    final auth = AuthScope.of(context);
    final (email, confirmation) = await (
      auth.readEmail(),
      AccountConfirmation.read(auth, ProviderSignInScope.maybeOf(context)),
    ).wait;
    return email == null ? null : (email: email, confirmation: confirmation);
  }

  void _reload() {
    setState(() {
      _account = _read();
    });
  }

  Future<void> _submit(String currentEmail) async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final newEmail = _newEmailController.text.trim();
    final password = _passwordController.text;
    await _request(
      (auth) => auth.requestEmailChange(
        currentEmail: currentEmail,
        newEmail: newEmail,
        currentPassword: password,
      ),
    );
  }

  Future<void> _submitWithProvider(
    String currentEmail,
    IdentityProvider provider,
    SignInProviders providers,
  ) async {
    final signIn = ProviderSignInScope.maybeOf(context);
    if (_submitting ||
        signIn == null ||
        !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final newEmail = _newEmailController.text.trim();
    await _request((auth) async {
      final ProviderCredential credential;
      try {
        credential = await signIn.signIn(provider, providers);
      } on ProviderSignInCancelled {
        throw const _Cancelled();
      } on ProviderSignInFailure {
        throw const AuthFailure(AuthFailureKind.unexpected);
      }
      await auth.requestEmailChangeWithProvider(
        currentEmail: currentEmail,
        newEmail: newEmail,
        credential: credential,
      );
    });
  }

  /// Runs [request] and ends on the links having gone out, or keeps the form
  /// and says why they have not.
  Future<void> _request(
    Future<void> Function(AuthController auth) request,
  ) async {
    final auth = AuthScope.of(context);
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    var cancelled = false;
    try {
      await request(auth);
    } on _Cancelled {
      cancelled = true;
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
      _requested = failure == null && !cancelled;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.changeEmailTitle)),
      body: SafeArea(
        child: !signedIn && !_requested
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: FutureBuilder<_Account?>(
                  future: _account,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(
                        key: ValueKey('change-email-loading'),
                        child: CircularProgressIndicator(),
                      );
                    }
                    final account = snapshot.data;
                    if (snapshot.hasError || account == null) {
                      return _loadFailed(messages);
                    }
                    if (_requested) {
                      return AutospacedText(
                        messages.changeEmailRequested,
                        key: const ValueKey('change-email-requested'),
                      );
                    }
                    return _form(messages, account);
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
        AutospacedText(
          messages.changeEmailLoadFailed,
          key: const ValueKey('change-email-load-error'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('change-email-reload'),
          onPressed: _reload,
          child: AutospacedText(messages.commonRetry),
        ),
      ],
    );
  }

  Widget _form(AppMessages messages, _Account account) {
    final failure = _failure;
    final currentEmail = account.email;
    final providers = account.confirmation.providers;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (failure != null) ...[
            AutospacedText(
              _failureCopy(messages, failure),
              key: const ValueKey('change-email-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 16),
          ],
          InputDecorator(
            decoration: InputDecoration(
              label: AutospacedText(messages.changeEmailCurrentLabel),
              border: const OutlineInputBorder(),
            ),
            child: AutospacedText(
              currentEmail,
              key: const ValueKey('change-email-current'),
            ),
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('change-email-new'),
            controller: _newEmailController,
            decoration: InputDecoration(
              label: AutospacedText(messages.changeEmailNewLabel),
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            textInputAction: providers == null
                ? TextInputAction.next
                : TextInputAction.done,
            errorBuilder: (context, error) => AutospacedText(error),
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
          if (providers == null)
            ..._passwordConfirmation(messages, currentEmail)
          else
            ..._providerConfirmation(
              messages,
              currentEmail,
              providers,
              account.confirmation.linked,
            ),
        ],
      ),
    );
  }

  List<Widget> _passwordConfirmation(
    AppMessages messages,
    String currentEmail,
  ) {
    return [
      PasswordField(
        key: const ValueKey('change-email-password'),
        controller: _passwordController,
        label: messages.changeEmailPasswordLabel,
        autofillHints: const [AutofillHints.password],
        textInputAction: TextInputAction.done,
        validator: (value) =>
            (value ?? '').trim().isEmpty ? messages.authPasswordRequired : null,
        onFieldSubmitted: (_) => unawaited(_submit(currentEmail)),
      ),
      const SizedBox(height: 24),
      FilledButton(
        key: const ValueKey('change-email-submit'),
        onPressed: _submitting ? null : () => unawaited(_submit(currentEmail)),
        child: _submitting
            ? const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : AutospacedText(messages.changeEmailSubmit),
      ),
    ];
  }

  List<Widget> _providerConfirmation(
    AppMessages messages,
    String currentEmail,
    SignInProviders providers,
    List<IdentityProvider> linked,
  ) {
    return [
      AutospacedText(
        linked.isEmpty
            ? messages.changeEmailNoProvider
            : messages.changeEmailConfirmWithProvider,
        key: const ValueKey('change-email-provider-note'),
      ),
      for (final provider in linked) ...[
        const SizedBox(height: 16),
        FilledButton(
          key: ValueKey('change-email-with-${provider.name}'),
          onPressed: _submitting
              ? null
              : () => unawaited(
                  _submitWithProvider(currentEmail, provider, providers),
                ),
          child: AutospacedText(switch (provider) {
            IdentityProvider.apple => messages.changeEmailWithApple,
            IdentityProvider.google => messages.changeEmailWithGoogle,
          }),
        ),
      ],
    ];
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.changeEmailFailed,
    };
  }
}

/// The reader closed the provider's sheet, which leaves the form as it was.
class _Cancelled implements Exception {
  const _Cancelled();
}
