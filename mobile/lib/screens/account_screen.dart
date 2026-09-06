import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_scope.dart';
import 'package:publira/router.dart';

/// The signed-in reader and the way out of that session.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    final session = auth.session;
    return Scaffold(
      appBar: AppBar(title: Text(messages.accountTitle)),
      body: SafeArea(
        child: session == null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(messages.accountSignedOut),
                      const SizedBox(height: 16),
                      FilledButton(
                        key: const ValueKey('account-sign-in'),
                        onPressed: () => context.push(AppRoutes.signIn),
                        child: Text(messages.commonSignIn),
                      ),
                    ],
                  ),
                ),
              )
            : ListView(
                children: [
                  ListTile(
                    key: const ValueKey('account-name'),
                    title: Text(messages.accountName),
                    subtitle: Text(
                      session.userName.isEmpty
                          ? messages.accountNameUnset
                          : session.userName,
                    ),
                  ),
                  const Divider(height: 1),
                  const _NotificationSwitch(),
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: OutlinedButton(
                      key: const ValueKey('account-sign-out'),
                      // The unregister needs the session, so the device comes
                      // off the delivery list before the session goes away.
                      onPressed: () => unawaited(_signOut(context)),
                      child: Text(messages.accountSignOut),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

Future<void> _signOut(BuildContext context) async {
  final auth = AuthScope.of(context);
  final push = PushScope.maybeOf(context);
  if (push != null) {
    await push.handleSignOut();
  }
  await auth.signOut();
}

/// New-episode notifications, and the only place the OS is ever asked for
/// permission.
///
/// A build carrying no Firebase project has nothing to offer, so the row is
/// left out rather than shown as a switch that cannot move.
class _NotificationSwitch extends StatelessWidget {
  const _NotificationSwitch();

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final push = PushScope.maybeOf(context);
    if (push == null || !push.supported) {
      return const SizedBox.shrink();
    }
    final failure = switch (push.failure) {
      PushFailure.denied => messages.accountNotificationsDenied,
      PushFailure.unavailable => messages.accountNotificationsUnavailable,
      null => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SwitchListTile(
          key: const ValueKey('account-notifications'),
          title: Text(messages.accountNotifications),
          subtitle: Text(messages.accountNotificationsDescription),
          value: push.enabled,
          onChanged: push.updating
              ? null
              : (value) => unawaited(push.setEnabled(value)),
        ),
        if (failure != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              failure,
              key: const ValueKey('account-notifications-failure'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }
}
