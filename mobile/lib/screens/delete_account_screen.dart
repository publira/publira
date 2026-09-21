import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// Deletes the signed-in account through `AuthService/DeleteMe`.
///
/// Nothing is sent until the reader has given the account's password and then
/// said yes a second time, because the deletion cannot be undone. Once it has
/// gone through the device is signed out, which also stops its notification
/// token, and the reader lands on the catalog.
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

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final messages = AppMessages.of(context);
        return AlertDialog(
          key: const ValueKey('delete-account-confirm'),
          title: Text(messages.deleteAccountConfirmTitle),
          content: Text(messages.deleteAccountConfirmDescription),
          actions: [
            TextButton(
              key: const ValueKey('delete-account-cancel'),
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(messages.commonCancel),
            ),
            FilledButton(
              key: const ValueKey('delete-account-confirm-delete'),
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
                foregroundColor: Theme.of(context).colorScheme.onError,
              ),
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(messages.deleteAccountConfirm),
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
    try {
      await auth.deleteAccount(password: _passwordController.text);
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (failure == null) {
      messenger.showSnackBar(
        SnackBar(content: Text(messages.deleteAccountDeleted)),
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
      appBar: AppBar(title: Text(messages.deleteAccountTitle)),
      body: SafeArea(
        // A deletion that has just gone through signs out before the screen
        // is left, which is not the signed-out state the notice is for.
        child: !signedIn && !_submitting
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
    final colors = Theme.of(context).colorScheme;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(messages.deleteAccountDescription),
          const SizedBox(height: 24),
          if (failure != null) ...[
            Text(
              _failureCopy(messages, failure),
              key: const ValueKey('delete-account-error'),
              style: TextStyle(color: colors.error),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('delete-account-password'),
            controller: _passwordController,
            decoration: InputDecoration(
              labelText: messages.deleteAccountPasswordLabel,
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
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
                : Text(messages.deleteAccountSubmit),
          ),
        ],
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.deleteAccountFailed,
    };
  }
}
