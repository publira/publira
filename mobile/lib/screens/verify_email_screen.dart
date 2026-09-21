import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// Where a confirmation link lands: it spends its token against
/// `AuthService/VerifyUserEmail` and says what that did.
///
/// The app claims the site's `/verify` path, so a reader who opens the link on
/// a device carrying this build finishes signing up here rather than in a
/// browser. A link that did nothing leads to the resend form rather than back
/// to sign-up: the account behind it already exists, so signing up again
/// creates nothing, and it cannot be signed into until the address is
/// confirmed.
class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key, required this.token});

  /// The value the link's `token` query carries. Empty for a link that lost
  /// it, which is a dead end the same way an unknown token is.
  final String token;

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  var _started = false;
  var _verifying = false;
  var _verified = false;

  /// Why the confirmation did not go through, `null` while it has not
  /// failed.
  AuthFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    unawaited(_verify());
  }

  Future<void> _verify() async {
    if (widget.token.isEmpty) {
      setState(() => _failure = AuthFailureKind.verificationTokenInvalid);
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _verifying = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    try {
      await auth.verifyEmail(widget.token);
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _verifying = false;
      _failure = failure;
      _verified = failure == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.verifyEmailTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: _body(messages),
          ),
        ),
      ),
    );
  }

  List<Widget> _body(AppMessages messages) {
    if (_verifying) {
      return [
        const Center(
          key: ValueKey('verify-email-progress'),
          child: CircularProgressIndicator(),
        ),
        const SizedBox(height: 24),
        Text(messages.verifyEmailVerifying, textAlign: TextAlign.center),
      ];
    }
    if (_verified) {
      return [
        Text(
          messages.verifyEmailVerified,
          key: const ValueKey('verify-email-verified'),
        ),
        const SizedBox(height: 24),
        FilledButton(
          key: const ValueKey('verify-email-sign-in'),
          onPressed: () => _leaveFor(AppRoutes.signIn),
          child: Text(messages.commonSignIn),
        ),
      ];
    }
    final failure = _failure ?? AuthFailureKind.unexpected;
    return [
      Text(
        _failureCopy(messages, failure),
        key: const ValueKey('verify-email-error'),
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
      const SizedBox(height: 24),
      // A link that could not be spent because the API was unreachable is
      // still a good link, so the way out of that one is another attempt
      // rather than asking for a replacement.
      if (failure == AuthFailureKind.network ||
          failure == AuthFailureKind.unexpected)
        FilledButton(
          key: const ValueKey('verify-email-retry'),
          onPressed: () => unawaited(_verify()),
          child: Text(messages.commonRetry),
        )
      else
        FilledButton(
          key: const ValueKey('verify-email-resend'),
          onPressed: () => _leaveFor(AppRoutes.resendVerification),
          child: Text(messages.authResendVerification),
        ),
    ];
  }

  /// Replaces this screen, so the back gesture does not spend the link again.
  void _leaveFor(String location) {
    if (context.canPop()) {
      context.pushReplacement(location);
    } else {
      context.go(location);
    }
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.verificationTokenInvalid =>
        messages.verifyEmailInvalidToken,
      AuthFailureKind.verificationTokenExpired => messages.verifyEmailExpired,
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      _ => messages.verifyEmailFailed,
    };
  }
}
