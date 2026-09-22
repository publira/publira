import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/email_change.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// Where either link of an email change lands: it spends its token against
/// `AuthService/ConfirmEmailChange` and says where the change stands.
///
/// The app claims the site's `/confirm-email` path, so a reader who opens a
/// link on a device carrying this build confirms it here rather than in a
/// browser. The token alone names the change, so the screen needs no session.
class ConfirmEmailScreen extends StatefulWidget {
  const ConfirmEmailScreen({super.key, required this.token});

  /// The value the link's `token` query carries. Empty for a link that lost
  /// it, which is a dead end the same way an unknown token is.
  final String token;

  @override
  State<ConfirmEmailScreen> createState() => _ConfirmEmailScreenState();
}

class _ConfirmEmailScreenState extends State<ConfirmEmailScreen> {
  var _started = false;
  var _confirming = false;
  EmailChangeProgress? _progress;

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
    unawaited(_confirm());
  }

  Future<void> _confirm() async {
    if (widget.token.isEmpty) {
      setState(() => _failure = AuthFailureKind.linkInvalid);
      return;
    }
    final auth = AuthScope.of(context);
    setState(() {
      _confirming = true;
      _failure = null;
    });
    EmailChangeProgress? progress;
    AuthFailureKind? failure;
    try {
      progress = await auth.confirmEmailChange(widget.token);
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _confirming = false;
      _progress = progress;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.confirmEmailTitle)),
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
    if (_confirming) {
      return [
        const Center(
          key: ValueKey('confirm-email-progress'),
          child: CircularProgressIndicator(),
        ),
        const SizedBox(height: 24),
        Text(messages.confirmEmailConfirming, textAlign: TextAlign.center),
      ];
    }
    final toAccount = FilledButton(
      key: const ValueKey('confirm-email-to-account'),
      onPressed: _leaveForAccount,
      child: Text(messages.confirmEmailToAccount),
    );
    final progress = _progress;
    if (progress != null) {
      return [
        Text(switch (progress) {
          EmailChangeProgress.changed => messages.confirmEmailChanged,
          EmailChangeProgress.awaitingCurrentEmail =>
            messages.confirmEmailPendingCurrentEmail,
          EmailChangeProgress.awaitingNewEmail =>
            messages.confirmEmailPendingNewEmail,
        }, key: const ValueKey('confirm-email-result')),
        const SizedBox(height: 24),
        toAccount,
      ];
    }
    final failure = _failure ?? AuthFailureKind.unexpected;
    return [
      Text(
        _failureCopy(messages, failure),
        key: const ValueKey('confirm-email-error'),
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
      const SizedBox(height: 24),
      // A link that could not be spent because the API was unreachable is
      // still a good link, so the way out of that one is another attempt. A
      // dead one leads to the account screen, where the change is asked for
      // again.
      if (failure == AuthFailureKind.network ||
          failure == AuthFailureKind.unexpected)
        FilledButton(
          key: const ValueKey('confirm-email-retry'),
          onPressed: () => unawaited(_confirm()),
          child: Text(messages.commonRetry),
        )
      else
        toAccount,
    ];
  }

  /// Replaces the account tab's stack with the account screen, so the back
  /// gesture does not spend the link again.
  void _leaveForAccount() {
    context.go(AppRoutes.account);
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.linkInvalid => messages.confirmEmailInvalidToken,
      AuthFailureKind.linkExpired => messages.confirmEmailExpired,
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      _ => messages.confirmEmailFailed,
    };
  }
}
