import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/forms/email_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/screens/provider_sign_in_buttons.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Email and password sign-in against `AuthService/Login`.
///
/// Creating an account and resetting a password are screens of their own,
/// which this form leads to.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, this.returnTo});

  /// Where the reader lands once signed in, in place of this form. `null`
  /// goes back to whatever sent them here.
  final String? returnTo;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  var _submitting = false;

  /// Why the last attempt failed, rendered in the current locale on each
  /// build rather than as the copy of the locale it failed under.
  AuthFailureKind? _failure;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
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
    try {
      await auth.signIn(
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );
    } on AuthFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() {
        _submitting = false;
        _failure = failure.kind;
      });
      return;
    } catch (_) {
      // Anything the API did not classify — a keychain that refused the write,
      // say. The form has to come back either way, or the button stays
      // disabled and the reader cannot try again.
      if (!mounted) {
        return;
      }
      setState(() {
        _submitting = false;
        _failure = AuthFailureKind.unexpected;
      });
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _submitting = false;
    });
    leaveSignIn(context, widget.returnTo);
  }

  /// The reset request form, carrying whatever address is typed so far.
  void _openResetPassword() {
    context.pushInTab(
      AppRoutes.resetPasswordPath(email: _emailController.text.trim()),
    );
  }

  /// The resend form, carrying the address the refused attempt used.
  void _openResendVerification() {
    context.pushInTab(
      AppRoutes.resendVerificationPath(email: _emailController.text.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.commonSignIn)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (failure != null) ...[
                  AutospacedText(
                    _failureCopy(messages, failure),
                    key: const ValueKey('sign-in-error'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  key: const ValueKey('sign-in-email'),
                  controller: _emailController,
                  decoration: InputDecoration(
                    label: AutospacedText(messages.authEmailLabel),
                    border: const OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.username],
                  textInputAction: TextInputAction.next,
                  errorBuilder: (context, error) => AutospacedText(error),
                  validator: (value) =>
                      validateAuthEmail(messages, value ?? ''),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  key: const ValueKey('sign-in-password'),
                  controller: _passwordController,
                  decoration: InputDecoration(
                    label: AutospacedText(messages.authPasswordLabel),
                    border: const OutlineInputBorder(),
                  ),
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  errorBuilder: (context, error) => AutospacedText(error),
                  validator: (value) => (value ?? '').isEmpty
                      ? messages.authPasswordRequired
                      : null,
                  onFieldSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  key: const ValueKey('sign-in-submit'),
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : AutospacedText(messages.commonSignIn),
                ),
                const SizedBox(height: 8),
                TextButton(
                  key: const ValueKey('sign-in-forgot-password'),
                  onPressed: _openResetPassword,
                  child: AutospacedText(messages.signInForgotPassword),
                ),
                // The address is already typed, so the reader is not asked
                // for it again on the way to a replacement link.
                if (failure == AuthFailureKind.emailNotVerified) ...[
                  const SizedBox(height: 16),
                  OutlinedButton(
                    key: const ValueKey('sign-in-resend-verification'),
                    onPressed: _openResendVerification,
                    child: AutospacedText(messages.authResendVerification),
                  ),
                ],
                ProviderSignInButtons(returnTo: widget.returnTo),
                const SizedBox(height: 24),
                AutospacedText(
                  messages.signInNoAccount,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  key: const ValueKey('sign-in-to-sign-up'),
                  onPressed: () => context.pushInTab(AppRoutes.signUp),
                  child: AutospacedText(messages.signInSignUp),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.invalidCredentials => messages.signInInvalidCredentials,
      AuthFailureKind.emailNotVerified => messages.signInEmailNotVerified,
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      AuthFailureKind.sessionExpired ||
      AuthFailureKind.consentRequired ||
      AuthFailureKind.providerRefused ||
      AuthFailureKind.lastSignInMethod ||
      AuthFailureKind.invalidInput ||
      AuthFailureKind.birthDateInvalid ||
      AuthFailureKind.birthDateAlreadySet ||
      AuthFailureKind.linkInvalid ||
      AuthFailureKind.linkExpired ||
      AuthFailureKind.unexpected => messages.signInFailed,
    };
  }
}

/// Leaves a sign-in screen for [returnTo], in its place so going back does not
/// land on it, or else for whatever asked for a signed-in reader: a locked
/// episode reloads its body from there, and the catalog picks up the account
/// entry point.
void leaveSignIn(BuildContext context, String? returnTo) {
  if (returnTo != null) {
    if (context.canPop()) {
      context.pushReplacementInTab(returnTo);
    } else {
      context.goInTab(returnTo);
    }
    return;
  }
  if (context.canPop()) {
    context.pop();
  } else {
    context.go(AppRoutes.catalog);
  }
}
