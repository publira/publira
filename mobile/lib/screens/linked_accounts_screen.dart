import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The Apple and Google accounts linked to the signed-in reader, through
/// `AuthService/ListMyIdentities`, each with a way to unlink it
/// (`AuthService/UnlinkIdentity`).
///
/// An account without a password keeps its last linked provider, because it
/// would have no way left to sign in.
class LinkedAccountsScreen extends StatefulWidget {
  const LinkedAccountsScreen({super.key});

  @override
  State<LinkedAccountsScreen> createState() => _LinkedAccountsScreenState();
}

class _LinkedAccountsScreenState extends State<LinkedAccountsScreen> {
  LinkedIdentities? _identities;
  var _loadFailed = false;

  /// The provider being unlinked, `null` while none is.
  IdentityProvider? _unlinking;

  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    final auth = AuthScope.of(context);
    if (!auth.isSignedIn) {
      return;
    }
    if (_loadFailed) {
      setState(() {
        _loadFailed = false;
      });
    }
    try {
      final identities = await auth.readLinkedIdentities();
      if (!mounted) {
        return;
      }
      setState(() {
        _identities = identities;
      });
    } on Exception {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadFailed = true;
      });
    }
  }

  Future<void> _unlink(IdentityProvider provider) async {
    if (_unlinking != null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _unlinking = provider;
    });
    String copy;
    try {
      await auth.unlinkIdentity(provider);
      copy = messages.linkedAccountsUnlinked;
    } on AuthFailure catch (failure) {
      copy = switch (failure.kind) {
        AuthFailureKind.lastSignInMethod => messages.linkedAccountsLast,
        AuthFailureKind.network => messages.errorsRpcUnavailable,
        _ => messages.linkedAccountsUnlinkFailed,
      };
    } on Exception {
      copy = messages.linkedAccountsUnlinkFailed;
    }
    messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    if (!mounted) {
      return;
    }
    setState(() {
      _unlinking = null;
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.linkedAccountsTitle)),
      body: SafeArea(
        child: !signedIn
            ? const SignedOutNotice()
            : ReadableScrollPadding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                builder: (context, padding) => ListView(
                  padding: padding,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: AutospacedText(messages.linkedAccountsDescription),
                    ),
                    const SizedBox(height: 8),
                    ..._rows(messages),
                  ],
                ),
              ),
      ),
    );
  }

  List<Widget> _rows(AppMessages messages) {
    final theme = Theme.of(context);
    final identities = _identities;
    if (identities == null) {
      if (!_loadFailed) {
        return const [
          Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          ),
        ];
      }
      return [
        ListTile(
          key: const ValueKey('linked-accounts-error'),
          title: AutospacedText(messages.linkedAccountsLoadFailed),
          trailing: TextButton(
            key: const ValueKey('linked-accounts-retry'),
            onPressed: () => unawaited(_load()),
            child: AutospacedText(messages.commonRetry),
          ),
        ),
      ];
    }
    if (identities.identities.isEmpty) {
      return [
        ListTile(
          key: const ValueKey('linked-accounts-empty'),
          title: AutospacedText(messages.linkedAccountsEmpty),
        ),
      ];
    }
    final keepsLast = identities.keepsLast;
    return [
      for (final identity in identities.identities)
        ListTile(
          key: ValueKey('linked-account-${identity.provider.name}'),
          isThreeLine: identity.linkedAt != null,
          title: AutospacedText(identity.provider.displayName),
          subtitle: AutospacedText(
            [
              identity.email,
              if (identity.linkedAt case final linkedAt?)
                messages.linkedAccountsLinkedAt(
                  date: messages.formatDateTime(linkedAt),
                ),
            ].join('\n'),
          ),
          trailing: TextButton(
            key: ValueKey('linked-account-unlink-${identity.provider.name}'),
            onPressed: keepsLast || _unlinking != null
                ? null
                : () => unawaited(_unlink(identity.provider)),
            child: AutospacedText(messages.linkedAccountsUnlink),
          ),
        ),
      if (keepsLast)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: AutospacedText(
            messages.linkedAccountsLast,
            key: const ValueKey('linked-accounts-last'),
            style: theme.textTheme.bodySmall,
          ),
        ),
    ];
  }
}
