import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/identity_provider.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// The passkeys the signed-in reader signs in to the tenant's site and this
/// app with, through `AuthService/ListMyPasskeys`, each with a way to rename it
/// (`AuthService/RenamePasskey`) and to remove it
/// (`AuthService/DeletePasskey`), and a way to add one on this device
/// (`AuthService/BeginPasskeyRegistration`,
/// `AuthService/FinishPasskeyRegistration`) where it uses the site's.
///
/// A passkey is named after it is made rather than before, so a system sheet
/// the reader closes leaves nothing half-named behind. An account without a
/// password or a linked provider keeps its last passkey, because it would
/// have no way left to sign in.
///
/// It opens as **Passkeys** under the account tab. A list the device cannot
/// add to is still listed, renamed, and removed.
class PasskeysScreen extends StatefulWidget {
  const PasskeysScreen({super.key});

  @override
  State<PasskeysScreen> createState() => _PasskeysScreenState();
}

class _PasskeysScreenState extends State<PasskeysScreen> {
  List<Passkey>? _passkeys;
  LinkedIdentities? _identities;
  var _loadFailed = false;

  /// Whether this device makes passkeys for the tenant's site.
  var _addOffered = false;

  /// What is in flight: [_adding], or the id of the passkey being renamed or
  /// removed. `null` while nothing is.
  String? _busy;

  static const _adding = '';

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
    final offered = _readAddOffered();
    try {
      final (passkeys, identities) = await (
        auth.readPasskeys(),
        auth.readLinkedIdentities(),
      ).wait;
      final addOffered = await offered;
      if (!mounted) {
        return;
      }
      setState(() {
        _passkeys = passkeys;
        _identities = identities;
        _addOffered = addOffered;
      });
    } on Object {
      if (!mounted) {
        return;
      }
      // A read after a change that fails leaves nothing the screen could
      // still trust: the list from before it would show a passkey just
      // removed, and offer to act on it.
      setState(() {
        _passkeys = null;
        _identities = null;
        _loadFailed = true;
      });
    }
  }

  /// Whether this device makes passkeys for the tenant. A tenant read that
  /// fails offers none, as on the sign-in screen, and leaves the passkeys to
  /// be listed, renamed, and removed.
  Future<bool> _readAddOffered() async {
    final authenticator = PasskeyAuthenticatorScope.maybeOf(context);
    if (authenticator == null) {
      return false;
    }
    try {
      final providers = await AuthScope.of(context).readSignInProviders();
      return await authenticator.offered(providers);
    } on Exception {
      return false;
    }
  }

  Future<void> _add() async {
    final authenticator = PasskeyAuthenticatorScope.maybeOf(context);
    if (_busy != null || authenticator == null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _busy = _adding;
    });
    String copy;
    try {
      final passkey = await auth.registerPasskey(authenticator);
      copy = messages.passkeysAdded;
      if (mounted) {
        final name = await _askName(isNew: true);
        if (name != null && name.isNotEmpty) {
          try {
            await auth.renamePasskey(passkey.id, name);
          } on Exception {
            // The passkey is added and signs the reader in all the same; the
            // row offers the name again.
            copy = messages.passkeysNameFailed;
          }
        }
      }
    } on PasskeyCancelled {
      copy = messages.passkeysAddCancelled;
    } on PasskeyAlreadyRegistered {
      copy = messages.passkeysAlreadyRegistered;
    } on AuthFailure catch (failure) {
      copy = switch (failure.kind) {
        AuthFailureKind.passkeyAlreadyRegistered =>
          messages.passkeysAlreadyRegistered,
        AuthFailureKind.passkeyLimit => messages.passkeysLimit,
        AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
        AuthFailureKind.network => messages.errorsRpcUnavailable,
        _ => messages.passkeysAddFailed,
      };
    } on Exception {
      copy = messages.passkeysAddFailed;
    }
    messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    await _settle();
  }

  Future<void> _rename(Passkey passkey) async {
    if (_busy != null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final name = await _askName(isNew: false, initial: passkey.name);
    if (name == null || !mounted) {
      return;
    }
    setState(() {
      _busy = passkey.id;
    });
    String copy;
    try {
      await auth.renamePasskey(passkey.id, name);
      copy = messages.passkeysNamed;
    } on AuthFailure catch (failure) {
      copy = switch (failure.kind) {
        AuthFailureKind.passkeyNotFound => messages.passkeysNotFound,
        AuthFailureKind.invalidInput => messages.passkeysNameTooLong,
        AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
        AuthFailureKind.network => messages.errorsRpcUnavailable,
        _ => messages.passkeysNameFailed,
      };
    } on Exception {
      copy = messages.passkeysNameFailed;
    }
    messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    await _settle();
  }

  Future<void> _remove(Passkey passkey) async {
    if (_busy != null) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _busy = passkey.id;
    });
    String copy;
    try {
      await auth.deletePasskey(passkey.id);
      copy = messages.passkeysRemoved;
    } on AuthFailure catch (failure) {
      copy = switch (failure.kind) {
        AuthFailureKind.lastSignInMethod => messages.passkeysLast,
        AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
        AuthFailureKind.network => messages.errorsRpcUnavailable,
        _ => messages.passkeysRemoveFailed,
      };
    } on Exception {
      copy = messages.passkeysRemoveFailed;
    }
    messenger.showSnackBar(SnackBar(content: AutospacedText(copy)));
    await _settle();
  }

  /// The name the reader gives a passkey, empty to leave it unnamed, or
  /// `null` where they dismissed the dialog. A new passkey's dialog skips
  /// rather than cancels, because the passkey is already made.
  Future<String?> _askName({required bool isNew, String initial = ''}) =>
      showDialog<String>(
        context: context,
        builder: (context) =>
            _PasskeyNameDialog(isNew: isNew, initial: initial),
      );

  /// Reads the list again after a change, which may have changed whatever
  /// the API answered, and only then lets the reader act on it, so a row the
  /// answer has outdated is never pressed.
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
      appBar: AppBar(title: AutospacedText(messages.passkeysTitle)),
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
                      child: AutospacedText(messages.passkeysDescription),
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
    final passkeys = _passkeys;
    final identities = _identities;
    if (passkeys == null || identities == null) {
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
          key: const ValueKey('passkeys-error'),
          title: AutospacedText(messages.passkeysLoadFailed),
          trailing: TextButton(
            key: const ValueKey('passkeys-retry'),
            onPressed: () => unawaited(_load()),
            child: AutospacedText(messages.commonRetry),
          ),
        ),
      ];
    }
    final keepsLast = identities.keepsLastPasskey(passkeys.length);
    return [
      if (passkeys.isEmpty)
        ListTile(
          key: const ValueKey('passkeys-empty'),
          title: AutospacedText(messages.passkeysEmpty),
        ),
      for (final passkey in passkeys)
        ListTile(
          key: ValueKey('passkey-${passkey.id}'),
          isThreeLine: true,
          title: AutospacedText(
            passkey.name.isEmpty ? messages.passkeysUnnamed : passkey.name,
          ),
          subtitle: AutospacedText(
            [
              if (passkey.createdAt case final createdAt?)
                messages.passkeysAddedAt(
                  date: messages.formatDateTime(createdAt),
                ),
              if (passkey.lastUsedAt case final lastUsedAt?)
                messages.passkeysLastUsedAt(
                  date: messages.formatDateTime(lastUsedAt),
                )
              else
                messages.passkeysNeverUsed,
            ].join('\n'),
          ),
          trailing: MenuAnchor(
            menuChildren: [
              MenuItemButton(
                key: ValueKey('passkey-rename-${passkey.id}'),
                onPressed: () => unawaited(_rename(passkey)),
                child: AutospacedText(messages.passkeysRename),
              ),
              MenuItemButton(
                key: ValueKey('passkey-remove-${passkey.id}'),
                onPressed: keepsLast ? null : () => unawaited(_remove(passkey)),
                child: AutospacedText(messages.passkeysRemove),
              ),
            ],
            builder: (context, menu, child) => AutospacedTooltip(
              message: messages.passkeysActions(
                name: passkey.name.isEmpty
                    ? messages.passkeysUnnamed
                    : passkey.name,
              ),
              child: IconButton(
                key: ValueKey('passkey-actions-${passkey.id}'),
                icon: const Icon(Icons.more_vert),
                onPressed: _busy != null
                    ? null
                    : () => menu.isOpen ? menu.close() : menu.open(),
              ),
            ),
          ),
        ),
      if (keepsLast)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: AutospacedText(
            messages.passkeysLast,
            key: const ValueKey('passkeys-last'),
            style: theme.textTheme.bodySmall,
          ),
        ),
      if (_addOffered)
        Padding(
          padding: const EdgeInsets.all(16),
          child: OutlinedButton(
            key: const ValueKey('passkeys-add'),
            onPressed: _busy != null ? null : () => unawaited(_add()),
            child: _busy == _adding
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : AutospacedText(messages.passkeysAdd),
          ),
        ),
    ];
  }
}

/// Asks for a passkey's name, at most the 64 characters the API keeps.
class _PasskeyNameDialog extends StatefulWidget {
  const _PasskeyNameDialog({required this.isNew, required this.initial});

  final bool isNew;
  final String initial;

  @override
  State<_PasskeyNameDialog> createState() => _PasskeyNameDialogState();
}

class _PasskeyNameDialogState extends State<_PasskeyNameDialog> {
  static const _maxLength = 64;

  final _formKey = GlobalKey<FormState>();
  late final _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    if (_formKey.currentState?.validate() ?? false) {
      Navigator.of(context).pop(_controller.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return AlertDialog(
      title: AutospacedText(messages.passkeysNameTitle),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AutospacedText(messages.passkeysNameDescription),
            const SizedBox(height: 16),
            TextFormField(
              key: const ValueKey('passkey-name'),
              controller: _controller,
              autofocus: true,
              decoration: InputDecoration(
                label: AutospacedText(messages.passkeysNameLabel),
                border: const OutlineInputBorder(),
              ),
              textInputAction: TextInputAction.done,
              errorBuilder: (context, error) => AutospacedText(error),
              // Counted the way the API counts, by code point, so a name of
              // emoji is measured as the server measures it.
              validator: (value) =>
                  (value ?? '').trim().runes.length > _maxLength
                  ? messages.passkeysNameTooLong
                  : null,
              onFieldSubmitted: (_) => _save(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('passkey-name-dismiss'),
          onPressed: () => Navigator.of(context).pop(),
          child: AutospacedText(
            widget.isNew ? messages.passkeysNameSkip : messages.commonCancel,
          ),
        ),
        FilledButton(
          key: const ValueKey('passkey-name-save'),
          onPressed: _save,
          child: AutospacedText(messages.passkeysNameSave),
        ),
      ],
    );
  }
}
