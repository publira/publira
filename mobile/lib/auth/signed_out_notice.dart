import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/router.dart';

/// What an account settings screen shows once nobody is signed in, such as
/// after the API stopped accepting the session mid-edit: the form has no
/// account left to change, so the way back in takes its place.
class SignedOutNotice extends StatelessWidget {
  const SignedOutNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(messages.accountSignedOut, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
            key: const ValueKey('account-settings-sign-in'),
            onPressed: () => context.push(AppRoutes.signIn),
            child: Text(messages.commonSignIn),
          ),
        ],
      ),
    );
  }
}

/// Closes an account settings screen once it has done its work, landing on
/// the account screen even when nothing is under it to pop back to.
void leaveAccountSettings(BuildContext context) {
  if (context.canPop()) {
    context.pop();
  } else {
    context.go(AppRoutes.account);
  }
}
