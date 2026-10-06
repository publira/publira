import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/account_confirmation.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/password_field.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Deletes the signed-in account through `AuthService/DeleteMe`.
///
/// Nothing is sent until the reader has confirmed who they are and then said
/// yes a second time, because the deletion cannot be undone: with the
/// account's password, or, for an account without one, with a fresh sign-in
/// to a provider linked to it. Once it has gone through the device is signed
/// out, which also stops its notification token, and the reader lands on the
/// catalog.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();

  var _submitting = false;
  AuthFailureKind? _failure;

  /// How the account confirms the deletion, `null` until it has been read.
  AccountConfirmation? _confirmation;
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
    _passwordController.dispose();
    super.dispose();
  }

  /// Reads whether the account has a password and, where it has none, which
  /// of its linked providers this device can sign in with.
  Future<void> _load() async {
    final auth = AuthScope.of(context);
    final signIn = ProviderSignInScope.maybeOf(context);
    if (!auth.isSignedIn) {
      return;
    }
    if (_loadFailed) {
      setState(() {
        _loadFailed = false;
      });
    }
    AccountConfirmation confirmation;
    try {
      confirmation = await AccountConfirmation.read(auth, signIn);
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
      _confirmation = confirmation;
    });
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final password = _passwordController.text;
    await _delete((auth) => auth.deleteAccount(password: password));
  }

  Future<void> _submitWithProvider(
    IdentityProvider provider,
    SignInProviders providers,
  ) async {
    final signIn = ProviderSignInScope.maybeOf(context);
    if (_submitting || signIn == null) {
      return;
    }
    await _delete((auth) async {
      final ProviderCredential credential;
      try {
        credential = await signIn.signIn(provider, providers);
      } on ProviderSignInCancelled {
        throw const _Cancelled();
      } on ProviderSignInFailure {
        throw const AuthFailure(AuthFailureKind.unexpected);
      }
      await auth.deleteAccountWithProvider(credential);
    });
  }

  /// Asks a second time, then runs [delete] and leaves for the catalog once
  /// it has gone through.
  Future<void> _delete(
    Future<void> Function(AuthController auth) delete,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final messages = AppMessages.of(context);
        return AlertDialog(
          key: const ValueKey('delete-account-confirm'),
          title: AutospacedText(messages.deleteAccountConfirmTitle),
          content: AutospacedText(messages.deleteAccountConfirmDescription),
          actions: [
            TextButton(
              key: const ValueKey('delete-account-cancel'),
              onPressed: () => Navigator.of(context).pop(false),
              child: AutospacedText(messages.commonCancel),
            ),
            FilledButton(
              key: const ValueKey('delete-account-confirm-delete'),
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
                foregroundColor: Theme.of(context).colorScheme.onError,
              ),
              onPressed: () => Navigator.of(context).pop(true),
              child: AutospacedText(messages.deleteAccountConfirm),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    var cancelled = false;
    try {
      await delete(auth);
    } on _Cancelled {
      cancelled = true;
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (failure == null && !cancelled) {
      messenger.showSnackBar(
        SnackBar(content: AutospacedText(messages.deleteAccountDeleted)),
      );
      router.go(AppRoutes.catalog);
      return;
    }
    if (!mounted) {
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
      appBar: AppBar(title: AutospacedText(messages.deleteAccountTitle)),
      body: SafeArea(
        // A deletion that has just gone through signs out before the screen
        // is left, which is not the signed-out state the notice is for.
        child: !signedIn && !_submitting
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ReadableWidth(
                  child: switch (_confirmation) {
                    _ when _loadFailed => _loadError(messages),
                    null => const Center(child: CircularProgressIndicator()),
                    AccountConfirmation(providers: null) => _form(messages),
                    AccountConfirmation(:final providers?, :final linked) =>
                      _providerForm(messages, providers, linked),
                  },
                ),
              ),
      ),
    );
  }

  Widget _form(AppMessages messages) {
    final failure = _failure;
    final colors = Theme.of(context).colorScheme;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(messages.deleteAccountDescription),
          const SizedBox(height: 24),
          if (failure != null) ...[
            AutospacedText(
              _failureCopy(messages, failure),
              key: const ValueKey('delete-account-error'),
              style: TextStyle(color: colors.error),
            ),
            const SizedBox(height: 16),
          ],
          PasswordField(
            key: const ValueKey('delete-account-password'),
            controller: _passwordController,
            label: messages.deleteAccountPasswordLabel,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            validator: (value) => (value ?? '').trim().isEmpty
                ? messages.authPasswordRequired
                : null,
            onFieldSubmitted: (_) => unawaited(_submit()),
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('delete-account-submit'),
            style: FilledButton.styleFrom(
              backgroundColor: colors.error,
              foregroundColor: colors.onError,
            ),
            onPressed: _submitting ? null : () => unawaited(_submit()),
            child: _submitting
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : AutospacedText(messages.deleteAccountSubmit),
          ),
        ],
      ),
    );
  }

  Widget _loadError(AppMessages messages) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(
          messages.deleteAccountLoadFailed,
          key: const ValueKey('delete-account-load-error'),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          key: const ValueKey('delete-account-retry'),
          onPressed: () => unawaited(_load()),
          child: AutospacedText(messages.commonRetry),
        ),
      ],
    );
  }

  Widget _providerForm(
    AppMessages messages,
    SignInProviders providers,
    List<IdentityProvider> linked,
  ) {
    final failure = _failure;
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AutospacedText(messages.deleteAccountDescription),
        const SizedBox(height: 16),
        AutospacedText(
          linked.isEmpty
              ? messages.deleteAccountNoProvider
              : messages.deleteAccountConfirmWithProvider,
          key: const ValueKey('delete-account-provider-note'),
        ),
        if (failure != null) ...[
          const SizedBox(height: 16),
          AutospacedText(
            _failureCopy(messages, failure),
            key: const ValueKey('delete-account-error'),
            style: TextStyle(color: colors.error),
          ),
        ],
        for (final provider in linked) ...[
          const SizedBox(height: 16),
          FilledButton(
            key: ValueKey('delete-account-with-${provider.name}'),
            style: FilledButton.styleFrom(
              backgroundColor: colors.error,
              foregroundColor: colors.onError,
            ),
            onPressed: _submitting
                ? null
                : () => unawaited(_submitWithProvider(provider, providers)),
            child: AutospacedText(switch (provider) {
              IdentityProvider.apple => messages.deleteAccountWithApple,
              IdentityProvider.google => messages.deleteAccountWithGoogle,
            }),
          ),
        ],
      ],
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      AuthFailureKind.lastTenantAdmin => messages.deleteAccountLastTenantAdmin,
      _ => messages.deleteAccountFailed,
    };
  }
}

/// The reader closed the provider's sheet, which leaves the screen as it was.
class _Cancelled implements Exception {
  const _Cancelled();
}
