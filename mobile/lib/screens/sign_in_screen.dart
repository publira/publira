import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// Email and password sign-in against `AuthService/Login`.
///
/// Creating an account and resetting a password stay on the website, so this
/// screen only names them.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

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
    // Back to whatever asked for a signed-in reader — a locked episode reloads
    // its body from here, and the catalog picks up the account entry point.
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.catalog);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    return Scaffold(
      appBar: AppBar(title: Text(messages.commonSignIn)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (failure != null) ...[
                  Text(
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
                    labelText: messages.signInEmailLabel,
                    border: const OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.username],
                  textInputAction: TextInputAction.next,
                  validator: (value) => (value ?? '').trim().isEmpty
                      ? messages.signInEmailRequired
                      : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  key: const ValueKey('sign-in-password'),
                  controller: _passwordController,
                  decoration: InputDecoration(
                    labelText: messages.signInPasswordLabel,
                    border: const OutlineInputBorder(),
                  ),
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  validator: (value) => (value ?? '').isEmpty
                      ? messages.signInPasswordRequired
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
                      : Text(messages.commonSignIn),
                ),
                const SizedBox(height: 24),
                Text(
                  messages.signInWebsiteNote,
                  style: Theme.of(context).textTheme.bodySmall,
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
      AuthFailureKind.sessionExpired ||
      AuthFailureKind.unexpected => messages.signInFailed,
    };
  }
}
