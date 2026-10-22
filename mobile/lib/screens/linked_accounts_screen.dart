import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/provider_sign_in.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The Apple and Google accounts linked to the signed-in reader, through
/// `AuthService/ListMyIdentities`, each with a way to unlink it
/// (`AuthService/UnlinkIdentity`), and a way to link each provider this device
/// offers that the account has none of yet (`AuthService/LinkIdentity`),
/// through the same sign-in as the sign-in screen's.
///
/// It opens as **Linked accounts** under the account tab. An account without
/// a password or a passkey keeps its last linked provider, because it would
/// have no way left to sign in.
class LinkedAccountsScreen extends StatefulWidget {
  const LinkedAccountsScreen({super.key});

  @override
  State<LinkedAccountsScreen> createState() => _LinkedAccountsScreenState();
}

class _LinkedAccountsScreenState extends State<LinkedAccountsScreen> {
  LinkedIdentities? _identities;
  var _loadFailed = false;

  /// What the tenant answered for its providers, which a link signs in with.
  var _providers = SignInProviders.none;

  /// The providers this device offers for the tenant's, in the order the
  /// sign-in screen shows them.
  var _offered = const <IdentityProvider>[];

  /// The provider being linked or unlinked, `null` while none is.
  IdentityProvider? _busy;

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
    final offered = _readOffered();
    try {
      final identities = await auth.readLinkedIdentities();
      final (providers, devices) = await offered;
      if (!mounted) {
        return;
      }
      setState(() {
        _identities = identities;
        _providers = providers;
        _offered = devices;
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

  /// The tenant's providers and the ones this device offers for them. A
  /// tenant read that fails offers none, as on the sign-in screen, and leaves
  /// the linked accounts to be listed and unlinked.
  Future<(SignInProviders, List<IdentityProvider>)> _readOffered() async {
    final signIn = ProviderSignInScope.maybeOf(context);
    if (signIn == null) {
      return (SignInProviders.none, const <IdentityProvider>[]);
    }
    try {
      final providers = await AuthScope.of(context).readSignInProviders();
      return (providers, await signIn.offered(providers));
    } on Exception {
      return (SignInProviders.none, const <IdentityProvider>[]);
    }
  }

  Future<void> _unlink(IdentityProvider provider) async {
    if (_busy != null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _busy = provider;
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
    await _settle();
  }

  /// Signs in with [provider] and links the account the reader signed in to.
  /// A closed provider sheet links nothing and says nothing.
  Future<void> _link(IdentityProvider provider) async {
    final signIn = ProviderSignInScope.maybeOf(context);
    if (_busy != null || signIn == null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final name = provider.displayName;
    setState(() {
      _busy = provider;
    });
    String? copy;
    try {
      final credential = await signIn.signIn(provider, _providers);
      await auth.linkIdentity(credential);
      copy = messages.linkedAccountsLinked(provider: name);
    } on ProviderSignInCancelled {
      copy = null;
    } on ProviderSignInFailure {
      copy = messages.signInProviderUnavailable;
    } on AuthFailure catch (failure) {
      copy = switch (failure.kind) {
        AuthFailureKind.linkedToAnotherAccount =>
          messages.linkedAccountsLinkAnotherAccount(provider: name),
        AuthFailureKind.providerAlreadyLinked =>
          messages.linkedAccountsLinkAlreadyLinked(provider: name),
        AuthFailureKind.invalidInput => messages.linkedAccountsLinkUnverified(
          provider: name,
        ),
        // The tenant stopped offering the provider after the screen read it.
        AuthFailureKind.providerRefused => messages.signInProviderUnavailable,
        AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
        AuthFailureKind.network => messages.errorsRpcUnavailable,
        _ => messages.linkedAccountsLinkFailed,
      };
    } on Exception {
      copy = messages.linkedAccountsLinkFailed;
    }
    if (copy != null) {
      messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    }
    await _settle();
  }

  /// Reads the accounts again after a link or an unlink, which either may
  /// have changed whatever the API answered, and only then lets the reader
  /// act on them, so a row the answer has outdated is never pressed.
  Future<void> _settle() async {
    if (!mounted) {
      return;
    }
    await _load();
    if (!mounted) {
      return;
    }
    setState(() {
      _busy = null;
    });
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
    final unlinked = [
      for (final provider in _offered)
        if (!identities.links(provider)) provider,
    ];
    if (identities.identities.isEmpty && unlinked.isEmpty) {
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
            onPressed: keepsLast || _busy != null
                ? null
                : () => unawaited(_unlink(identity.provider)),
            child: AutospacedText(messages.linkedAccountsUnlink),
          ),
        ),
      for (final provider in unlinked)
        ListTile(
          key: ValueKey('linked-account-${provider.name}'),
          title: AutospacedText(provider.displayName),
          subtitle: AutospacedText(messages.linkedAccountsNotLinked),
          trailing: TextButton(
            key: ValueKey('linked-account-link-${provider.name}'),
            onPressed: _busy != null ? null : () => unawaited(_link(provider)),
            child: AutospacedText(messages.linkedAccountsLink),
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
