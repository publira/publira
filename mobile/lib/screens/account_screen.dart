import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/router.dart';

/// The signed-in reader and the way out of that session.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final session = auth.session;
    return Scaffold(
      appBar: AppBar(title: const Text('アカウント')),
      body: SafeArea(
        child: session == null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('サインインしていません'),
                      const SizedBox(height: 16),
                      FilledButton(
                        key: const ValueKey('account-sign-in'),
                        onPressed: () => context.push(AppRoutes.signIn),
                        child: const Text('サインイン'),
                      ),
                    ],
                  ),
                ),
              )
            : ListView(
                children: [
                  ListTile(
                    key: const ValueKey('account-name'),
                    title: const Text('お名前'),
                    subtitle: Text(
                      session.userName.isEmpty ? '（未設定）' : session.userName,
                    ),
                  ),
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: OutlinedButton(
                      key: const ValueKey('account-sign-out'),
                      onPressed: () => unawaited(auth.signOut()),
                      child: const Text('サインアウト'),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
