import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
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
  String? _error;

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
      _error = null;
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
        _error = _failureCopy(failure);
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
        _error = _unexpectedCopy;
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
    final error = _error;
    return Scaffold(
      appBar: AppBar(title: const Text('サインイン')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (error != null) ...[
                  Text(
                    error,
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
                  decoration: const InputDecoration(
                    labelText: 'メールアドレス',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.username],
                  textInputAction: TextInputAction.next,
                  validator: (value) =>
                      (value ?? '').trim().isEmpty ? 'メールアドレスを入力してください' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  key: const ValueKey('sign-in-password'),
                  controller: _passwordController,
                  decoration: const InputDecoration(
                    labelText: 'パスワード',
                    border: OutlineInputBorder(),
                  ),
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  validator: (value) =>
                      (value ?? '').isEmpty ? 'パスワードを入力してください' : null,
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
                      : const Text('サインイン'),
                ),
                const SizedBox(height: 24),
                Text(
                  'アカウントの作成とパスワードの再設定はウェブサイトで行えます。',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static const _unexpectedCopy = 'サインインできませんでした';

  String _failureCopy(AuthFailure failure) {
    return switch (failure.kind) {
      AuthFailureKind.invalidCredentials => 'メールアドレスまたはパスワードが正しくありません',
      AuthFailureKind.emailNotVerified =>
        'メールアドレスの確認が完了していません。確認メールのリンクを開いてください。',
      AuthFailureKind.network => 'サインインできませんでした。通信状況を確認して再試行してください。',
      AuthFailureKind.sessionExpired ||
      AuthFailureKind.unexpected => _unexpectedCopy,
    };
  }
}
