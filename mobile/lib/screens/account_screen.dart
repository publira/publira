import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/gen/app_messages.dart';
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
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: OutlinedButton(
                      key: const ValueKey('account-sign-out'),
                      onPressed: () => unawaited(auth.signOut()),
                      child: Text(messages.accountSignOut),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
