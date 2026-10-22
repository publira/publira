import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/account_icon.dart';
import 'package:publira/auth/account_icon_picker.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/notification_settings.dart';
import 'package:publira/auth/passkey.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/auth/reader_icon_policy.dart';
import 'package:publira/contact/contact_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/pages/page_repository.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/push/push_controller.dart';
import 'package:publira/push/push_scope.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The signed-in reader, the settings of their account, and the way out of
/// that session.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    final session = auth.session;
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.accountTitle)),
      body: SafeArea(
        child: session == null
            ? ReadableScrollPadding(
                builder: (context, padding) => ListView(
                  padding: padding,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        children: [
                          AutospacedText(messages.accountSignedOut),
                          const SizedBox(height: 16),
                          FilledButton(
                            key: const ValueKey('account-sign-in'),
                            onPressed: () =>
                                context.pushInTab(AppRoutes.signIn),
                            child: AutospacedText(messages.commonSignIn),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    const _PagesEntry(),
                    const _ContactEntry(),
                  ],
                ),
              )
            : ReadableScrollPadding(
                builder: (context, padding) => ListView(
                  key: const ValueKey('account-list'),
                  padding: padding,
                  children: [
                    // Keyed by the reader, so a change in flight for one
                    // account is not reported on another's screen.
                    _IconSection(
                      key: ValueKey(('icon', session.userPublicId)),
                      readerId: session.userPublicId,
                      iconUrl: session.userIconUrl,
                      iconPresetId: session.userIconPresetId,
                    ),
                    ListTile(
                      key: const ValueKey('account-name'),
                      title: AutospacedText(messages.accountName),
                      subtitle: AutospacedText(
                        session.userName.isEmpty
                            ? messages.accountNameUnset
                            : session.userName,
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(AppRoutes.accountName),
                    ),
                    const Divider(height: 1),
                    const _PurchasesEntry(),
                    ListTile(
                      key: const ValueKey('account-reading-history'),
                      title: AutospacedText(messages.readingHistoryTitle),
                      subtitle: AutospacedText(
                        messages.readingHistoryAccountDescription,
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () =>
                          context.push(AppRoutes.accountReadingHistory),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      key: const ValueKey('account-follow-updates'),
                      title: AutospacedText(messages.followUpdatesTitle),
                      subtitle: AutospacedText(
                        messages.followUpdatesAccountDescription,
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(AppRoutes.accountFollowUpdates),
                    ),
                    const Divider(height: 1),
                    // Keyed by the reader, so another account signing in reads
                    // its own date rather than showing the last one's.
                    _BirthDateRow(key: ValueKey(session.userPublicId)),
                    ListTile(
                      key: const ValueKey('account-change-email'),
                      title: AutospacedText(messages.accountChangeEmail),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(AppRoutes.accountEmail),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      key: const ValueKey('account-change-password'),
                      title: AutospacedText(messages.accountChangePassword),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(AppRoutes.accountPassword),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      key: const ValueKey('account-linked-accounts'),
                      title: AutospacedText(messages.accountLinkedAccounts),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () =>
                          context.push(AppRoutes.accountLinkedAccounts),
                    ),
                    const Divider(height: 1),
                    // Only where the app has a passkey authenticator, which
                    // is where the site's passkeys sign the reader in to it.
                    if (PasskeyAuthenticatorScope.maybeOf(context) != null) ...[
                      ListTile(
                        key: const ValueKey('account-passkeys'),
                        title: AutospacedText(messages.accountPasskeys),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push(AppRoutes.accountPasskeys),
                      ),
                      const Divider(height: 1),
                    ],
                    // Keyed by the reader as well, under a name of its own so
                    // it does not share a key with the birth date row.
                    _NotificationSettingsSection(
                      key: ValueKey((
                        'notification-settings',
                        session.userPublicId,
                      )),
                    ),
                    const _PagesEntry(),
                    const _ContactEntry(),
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: OutlinedButton(
                        key: const ValueKey('account-sign-out'),
                        // The unregister needs the session, so the device comes
                        // off the delivery list before the session goes away.
                        onPressed: () => unawaited(signOut(context)),
                        child: AutospacedText(messages.accountSignOut),
                      ),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      key: const ValueKey('account-delete'),
                      title: AutospacedText(
                        messages.accountDelete,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(AppRoutes.accountDelete),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Signs the reader out of this device, taking the device off the delivery
/// list first, while the session it unregisters with is still good.
Future<void> signOut(BuildContext context) async {
  final auth = AuthScope.of(context);
  final push = PushScope.maybeOf(context);
  if (push != null) {
    await push.handleSignOut();
  }
  await auth.signOut();
}

/// The reader's icon, or the fallback an account without one gets, and the
/// controls the tenant's reader icon policy allows: an upload from the
/// device, a pick from the tenant's presets, or no icon at all.
///
/// The policy is read with the screen, so no control here leads to a change
/// the API refuses under it. Removing the icon is accepted under every policy
/// that shows one.
///
/// Each change is saved as soon as it is made, the way the site's settings
/// save it, and the session takes the icon the API answers with, so every
/// screen that draws the reader shows the change.
class _IconSection extends StatefulWidget {
  const _IconSection({
    super.key,
    required this.readerId,
    required this.iconUrl,
    required this.iconPresetId,
  });

  final String readerId;
  final Uri? iconUrl;
  final String? iconPresetId;

  @override
  State<_IconSection> createState() => _IconSectionState();
}

enum _IconChange { upload, select, remove }

class _IconSectionState extends State<_IconSection> {
  static const _radius = 40.0;
  static const _presetRadius = 24.0;

  late Future<ReaderIconChoice> _choice;
  _IconChange? _changing;
  String? _failure;
  var _started = false;

  /// The recovery of a pick Android kept, which a change the reader asks for
  /// waits out, so the image they chose before the app was ended never lands
  /// after the one they choose now.
  Future<void> _recovering = Future.value();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _choice = AuthScope.of(context).readIconChoice();
    final picker = AccountIconPickerScope.maybeOf(context);
    if (picker != null) {
      _recovering = _recover(picker);
      unawaited(_recovering);
    }
  }

  void _reload() {
    setState(() {
      _choice = AuthScope.of(context).readIconChoice();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<ReaderIconChoice>(
      future: _choice,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _section(
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 24, 16, 16),
              child: SizedBox(
                height: _radius * 2,
                child: Center(
                  child: CircularProgressIndicator(
                    key: ValueKey('account-icon-loading'),
                  ),
                ),
              ),
            ),
          );
        }
        if (snapshot.hasError) {
          return _section(
            ListTile(
              key: const ValueKey('account-icon-error'),
              title: AutospacedText(messages.accountIconAlt),
              subtitle: AutospacedText(messages.accountIconLoadFailed),
              trailing: TextButton(
                key: const ValueKey('account-icon-retry'),
                onPressed: _reload,
                child: AutospacedText(messages.commonRetry),
              ),
            ),
          );
        }
        return switch (snapshot.requireData) {
          ReaderIconUpload() => _section(_uploadField(context)),
          ReaderIconPresets(:final presets)
              when presets.isNotEmpty || widget.iconUrl != null =>
            _section(_presetField(context, presets)),
          // Nothing to show and nothing to do: a tenant that allows no icon
          // cleared the account's, and one with no presets yet offers none.
          ReaderIconPresets() ||
          ReaderIconDisabled() => const SizedBox.shrink(),
        };
      },
    );
  }

  Widget _section(Widget content) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [content, const Divider(height: 1)],
    );
  }

  /// The icon with the controls that upload, replace, and remove it, which a
  /// build carrying no picker leaves out.
  Widget _uploadField(BuildContext context) {
    final messages = AppMessages.of(context);
    final picker = AccountIconPickerScope.maybeOf(context);
    return _field(
      context,
      controls: picker == null
          ? const []
          : [
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton(
                    key: const ValueKey('account-icon-upload'),
                    onPressed: _changing == null
                        ? () => unawaited(_upload(picker))
                        : null,
                    child: AutospacedText(
                      _changing == _IconChange.upload
                          ? messages.accountIconUploading
                          : widget.iconUrl == null
                          ? messages.accountIconUpload
                          : messages.accountIconReplace,
                    ),
                  ),
                  if (widget.iconUrl != null) _removeButton(messages),
                ],
              ),
              _help(context, messages.accountIconHelp),
            ],
    );
  }

  /// The icon with the tenant's presets to pick from in place of an upload,
  /// the one the account shows marked, and the control that removes it.
  Widget _presetField(BuildContext context, List<ReaderIconPreset> presets) {
    final messages = AppMessages.of(context);
    return _field(
      context,
      controls: [
        if (widget.iconUrl != null) _removeButton(messages),
        if (presets.isNotEmpty) ...[
          Semantics(
            container: true,
            label: messages.accountIconPresetsLabel,
            child: Wrap(
              key: const ValueKey('account-icon-presets'),
              alignment: WrapAlignment.center,
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final (index, preset) in presets.indexed)
                  _presetButton(context, preset, number: index + 1),
              ],
            ),
          ),
          _help(context, messages.accountIconPresetHelp),
        ],
      ],
    );
  }

  Widget _presetButton(
    BuildContext context,
    ReaderIconPreset preset, {
    required int number,
  }) {
    final messages = AppMessages.of(context);
    final colors = Theme.of(context).colorScheme;
    final current = preset.id == widget.iconPresetId;
    final enabled = _changing == null;
    // The image carries no label of its own, so the number names the choice.
    return Semantics(
      container: true,
      button: true,
      selected: current,
      enabled: enabled,
      label: messages.accountIconPresetOption(number: number),
      child: Opacity(
        opacity: enabled ? 1 : 0.6,
        child: InkWell(
          key: ValueKey(('account-icon-preset', preset.id)),
          customBorder: const CircleBorder(),
          // The one the account shows is already the answer, so picking it
          // again sends nothing.
          onTap: enabled
              ? () {
                  if (!current) {
                    unawaited(_select(preset.id));
                  }
                }
              : null,
          child: Container(
            padding: const EdgeInsets.all(2),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: current ? colors.primary : colors.outlineVariant,
                width: current ? 3 : 1,
              ),
            ),
            child: _avatar(
              context,
              iconUrl: preset.iconUrl,
              radius: _presetRadius,
            ),
          ),
        ),
      ),
    );
  }

  Widget _removeButton(AppMessages messages) {
    return TextButton(
      key: const ValueKey('account-icon-remove'),
      onPressed: _changing == null ? () => unawaited(_remove()) : null,
      child: AutospacedText(
        _changing == _IconChange.remove
            ? messages.accountIconRemoving
            : messages.accountIconRemove,
      ),
    );
  }

  Widget _help(BuildContext context, String text) {
    final theme = Theme.of(context);
    return AutospacedText(
      text,
      textAlign: TextAlign.center,
      style: theme.textTheme.bodySmall?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }

  /// The account's icon above [controls], and why the last change failed
  /// below them.
  Widget _field(BuildContext context, {required List<Widget> controls}) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final iconUrl = widget.iconUrl;
    final failure = _failure;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
      child: Column(
        children: [
          Semantics(
            image: true,
            label: messages.accountIconAlt,
            child: _avatar(
              context,
              key: ValueKey(
                iconUrl == null ? 'account-icon-fallback' : 'account-icon',
              ),
              iconUrl: iconUrl,
              radius: _radius,
            ),
          ),
          for (final control in controls) ...[
            const SizedBox(height: 12),
            control,
          ],
          if (failure != null) ...[
            const SizedBox(height: 8),
            AutospacedText(
              failure,
              key: const ValueKey('account-icon-failure'),
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }

  /// The image at [iconUrl] in a circle of [radius], or the fallback an
  /// account without an icon gets.
  Widget _avatar(
    BuildContext context, {
    Key? key,
    required Uri? iconUrl,
    required double radius,
  }) {
    final theme = Theme.of(context);
    return CircleAvatar(
      key: key,
      radius: radius,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      // Decoded no larger than the circle, for the reason a cover is.
      foregroundImage: iconUrl == null
          ? null
          : ResizeImage.resizeIfNeeded(
              (radius * 2 * MediaQuery.devicePixelRatioOf(context)).round(),
              null,
              NetworkImage(
                iconUrl.toString(),
                headers: AuthScope.of(context).imageRequestHeaders,
              ),
            ),
      // A URL that has stopped answering leaves the fallback showing.
      onForegroundImageError: iconUrl == null ? null : (_, _) {},
      child: Icon(
        Icons.person_outline,
        size: radius,
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }

  Future<void> _upload(AccountIconPicker picker) async {
    final messages = AppMessages.of(context);
    await _recovering;
    if (!mounted || _changing != null) {
      return;
    }
    // Held from the pick on, so nothing else is sent while the picker is open.
    setState(() {
      _changing = _IconChange.upload;
      _failure = null;
    });
    final Uint8List? bytes;
    try {
      bytes = await picker.pick(reader: widget.readerId);
    } on Exception {
      if (mounted) {
        setState(() {
          _changing = null;
          _failure = messages.accountIconUploadFailed;
        });
      }
      return;
    }
    if (!mounted) {
      return;
    }
    if (bytes == null) {
      setState(() => _changing = null);
      return;
    }
    await _send(bytes);
  }

  /// Sends the image a pick handed over after the platform had ended the app
  /// under the picker, which is what the reader asked for when they chose it,
  /// as long as the tenant still takes an upload.
  Future<void> _recover(AccountIconPicker picker) async {
    final Uint8List? bytes;
    try {
      bytes = await picker.recover(reader: widget.readerId);
    } on Exception {
      return;
    }
    if (bytes == null || !mounted || _changing != null) {
      return;
    }
    final ReaderIconChoice choice;
    try {
      choice = await _choice;
    } on Exception {
      return;
    }
    if (choice is! ReaderIconUpload || !mounted || _changing != null) {
      return;
    }
    setState(() => _changing = _IconChange.upload);
    await _send(bytes);
  }

  /// Checks [bytes] against the API's limits and uploads them if they pass,
  /// with [_changing] already set by the caller.
  Future<void> _send(Uint8List bytes) async {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    final (upload, problem) = prepareAccountIcon(bytes);
    if (upload == null) {
      setState(() {
        _changing = null;
        _failure = switch (problem) {
          AccountIconProblem.tooLarge => messages.accountIconTooLarge,
          AccountIconProblem.tooSmall => messages.accountIconTooSmall,
          AccountIconProblem.unsupported ||
          null => messages.accountIconUnsupported,
        };
      });
      return;
    }
    await _change(
      () => auth.uploadIcon(upload),
      done: messages.accountIconUploaded,
      failed: messages.accountIconUploadFailed,
    );
  }

  Future<void> _select(String presetId) async {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    await _recovering;
    if (!mounted || _changing != null) {
      return;
    }
    setState(() {
      _changing = _IconChange.select;
      _failure = null;
    });
    await _change(
      () => auth.selectIcon(presetId),
      done: messages.accountIconSelected,
      failed: messages.accountIconSelectFailed,
    );
  }

  Future<void> _remove() async {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    await _recovering;
    if (!mounted || _changing != null) {
      return;
    }
    setState(() {
      _changing = _IconChange.remove;
      _failure = null;
    });
    await _change(
      auth.removeIcon,
      done: messages.accountIconRemoved,
      failed: messages.accountIconRemoveFailed,
    );
  }

  /// Runs [call] and says how it went: [done] in a snack bar, or why it
  /// failed below the controls, with [failed] for anything the reader can do
  /// nothing about but try again.
  ///
  /// A change the tenant's policy no longer allows, or a preset it no longer
  /// holds, means the controls were drawn from a policy that has changed
  /// since. The policy is read again and the controls drawn anew, which may
  /// leave no field to word the refusal under, so it goes to a snack bar.
  Future<void> _change(
    Future<void> Function() call, {
    required String done,
    required String failed,
  }) async {
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await call();
      messenger?.showSnackBar(SnackBar(content: AutospacedText(done)));
      if (mounted) {
        setState(() => _changing = null);
      }
    } on AuthFailure catch (failure) {
      if (!mounted) {
        return;
      }
      final outdated = switch (failure.kind) {
        AuthFailureKind.iconNotAllowed => messages.accountIconNotAllowed,
        AuthFailureKind.iconPresetUnavailable =>
          messages.accountIconPresetUnavailable,
        _ => null,
      };
      if (outdated != null) {
        messenger?.showSnackBar(SnackBar(content: AutospacedText(outdated)));
        _changing = null;
        _reload();
        return;
      }
      setState(() {
        _changing = null;
        _failure = switch (failure.kind) {
          AuthFailureKind.iconRefused => messages.accountIconRefused,
          AuthFailureKind.storageNotConfigured =>
            messages.accountIconStorageUnavailable,
          AuthFailureKind.network => messages.errorsRpcUnavailable,
          AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
          _ => failed,
        };
      });
    } on Exception {
      // A credential store that refused the session the API answered with,
      // which the other account settings word the same way.
      if (!mounted) {
        return;
      }
      setState(() {
        _changing = null;
        _failure = failed;
      });
    }
  }
}

/// The way to every episode the reader has bought, which the API keeps for
/// the account, apart from the downloads the library keeps for this device.
///
/// A build carrying no [PurchaseScope] sells nothing, so the row is left out.
class _PurchasesEntry extends StatelessWidget {
  const _PurchasesEntry();

  @override
  Widget build(BuildContext context) {
    if (PurchaseScope.repositoryOf(context) == null) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          key: const ValueKey('account-purchases'),
          title: AutospacedText(messages.purchasesTitle),
          subtitle: AutospacedText(messages.purchasesAccountDescription),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push(AppRoutes.accountPurchases),
        ),
        const Divider(height: 1),
      ],
    );
  }
}

/// The way to the pages the storefront's footer lists, so a reader can
/// reread the terms they agreed to, for a guest as much as for a signed-in
/// reader.
///
/// A build carrying no [PageScope] has no pages to read, so the row is left
/// out.
class _PagesEntry extends StatelessWidget {
  const _PagesEntry();

  @override
  Widget build(BuildContext context) {
    if (PageScope.maybeOf(context) == null) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          key: const ValueKey('account-pages'),
          title: AutospacedText(messages.accountPages),
          subtitle: AutospacedText(messages.accountPagesDescription),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push(AppRoutes.accountPages),
        ),
        const Divider(height: 1),
      ],
    );
  }
}

/// The way to a message for the people who run the tenant, for a guest as
/// much as for a signed-in reader.
///
/// A build carrying no [ContactScope] has nowhere to send one, so the row is
/// left out.
class _ContactEntry extends StatelessWidget {
  const _ContactEntry();

  @override
  Widget build(BuildContext context) {
    if (ContactScope.maybeOf(context) == null) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          key: const ValueKey('account-contact'),
          title: AutospacedText(messages.accountContact),
          subtitle: AutospacedText(messages.accountContactDescription),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push(AppRoutes.accountContact),
        ),
        const Divider(height: 1),
      ],
    );
  }
}

/// Whether this device receives push notifications at all, and the only place
/// the OS is ever asked for permission. Which kinds of notification are pushed
/// to it is the Mobile app channel of the notification preferences.
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
          title: AutospacedText(messages.accountNotifications),
          subtitle: AutospacedText(messages.accountNotificationsDescription),
          value: push.enabled,
          onChanged: push.updating
              ? null
              : (value) => unawaited(push.setEnabled(value)),
        ),
        if (failure != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: AutospacedText(
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

/// The email switch, as the place a refused change of it is worded, beside
/// the category or channel a refused change of the preferences is worded
/// under.
const _emailRow = #email;

/// Which notifications the account takes: a section per category with a
/// switch per channel the server delivers, this device's own push switch, and
/// notification email. The account holds all of it rather than the device, so
/// the storefront's notification settings read and write the same settings.
///
/// Each change is saved as soon as it is made, in one request however many
/// switches it moves. Email is held here with the rest because every request
/// writes it.
///
/// Keyed by the reader, so another account signing in reads its own settings
/// rather than showing the last one's.
class _NotificationSettingsSection extends StatefulWidget {
  const _NotificationSettingsSection({super.key});

  @override
  State<_NotificationSettingsSection> createState() =>
      _NotificationSettingsSectionState();
}

class _NotificationSettingsSectionState
    extends State<_NotificationSettingsSection> {
  late Future<NotificationSettings?> _future;
  var _started = false;

  /// The settings the switches show once they have been read, which a change
  /// the reader makes moves at once and a refused one moves back.
  NotificationSettings? _settings;
  var _saving = false;

  /// Why the last change failed, and the [NotificationCategory],
  /// [NotificationChannel], or [_emailRow] it is worded under.
  ({Object at, String message})? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = AuthScope.of(context).readNotificationSettings();
  }

  void _reload() {
    setState(() {
      _settings = null;
      _future = AuthScope.of(context).readNotificationSettings();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<NotificationSettings?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _section([
            ListTile(
              key: const ValueKey('account-notification-settings-loading'),
              title: AutospacedText(messages.accountNotificationPreferences),
              trailing: const SizedBox.square(
                dimension: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            const Divider(height: 1),
            // The device's own switch reads nothing from the account, so a
            // read still in flight does not hold back turning it off.
            const _NotificationSwitch(),
          ]);
        }
        if (snapshot.hasError) {
          return _section([
            ListTile(
              key: const ValueKey('account-notification-settings-error'),
              title: AutospacedText(messages.accountNotificationPreferences),
              subtitle: AutospacedText(
                messages.accountNotificationSettingsLoadFailed,
              ),
              trailing: TextButton(
                key: const ValueKey('account-notification-settings-retry'),
                onPressed: _reload,
                child: AutospacedText(messages.commonRetry),
              ),
            ),
            const Divider(height: 1),
            // Nor does a read that failed, which leaves the device's way out
            // of push notifications open while the API is unreachable.
            const _NotificationSwitch(),
          ]);
        }
        final settings = _settings ?? snapshot.data;
        if (settings == null) {
          return const SizedBox.shrink();
        }
        return _section([
          ListTile(
            title: AutospacedText(messages.accountNotificationPreferences),
            subtitle: AutospacedText(
              messages.accountNotificationPreferencesDescription,
            ),
          ),
          _channelRow(context, settings),
          ..._failureAt(NotificationChannel.values),
          const Divider(height: 1),
          for (final category in NotificationCategory.values) ...[
            ..._categorySection(context, settings, category),
            const Divider(height: 1),
          ],
          // Beside the Mobile app switches it feeds, which reach this device
          // only while it is on.
          const _NotificationSwitch(),
          SwitchListTile(
            key: const ValueKey('account-email-notifications'),
            title: AutospacedText(messages.accountEmailNotifications),
            subtitle: AutospacedText(
              messages.accountEmailNotificationsDescription,
            ),
            value: settings.emailEnabled,
            onChanged: _saving
                ? null
                : (value) => unawaited(
                    _change(settings, at: _emailRow, emailEnabled: value),
                  ),
          ),
          ..._failureAt(const [_emailRow]),
          const Divider(height: 1),
        ]);
      },
    );
  }

  /// The heading of every channel, each of which turns that channel on or
  /// off in every section at once.
  Widget _channelRow(BuildContext context, NotificationSettings settings) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 16, 8),
      child: Wrap(
        spacing: 4,
        children: [
          for (final channel in NotificationChannel.values)
            _GroupToggle(
              key: ValueKey(('account-notification-channel', channel.name)),
              label: _channelLabel(AppMessages.of(context), channel),
              value: settings.stateOf(cellsOfChannel(channel)),
              onPressed: _saving
                  ? null
                  : () => unawaited(
                      _change(
                        settings,
                        at: channel,
                        cells: settings.toggle(cellsOfChannel(channel)),
                      ),
                    ),
            ),
        ],
      ),
    );
  }

  /// The title of [category], which turns every switch of it on or off at
  /// once, above a switch per channel the server delivers it on.
  List<Widget> _categorySection(
    BuildContext context,
    NotificationSettings settings,
    NotificationCategory category,
  ) {
    final messages = AppMessages.of(context);
    final cells = cellsOfCategory(category);
    return [
      CheckboxListTile(
        key: ValueKey(('account-notification-category', category.name)),
        tristate: true,
        title: AutospacedText(
          _categoryLabel(messages, category),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        value: settings.stateOf(cells),
        onChanged: _saving
            ? null
            : (_) => unawaited(
                _change(settings, at: category, cells: settings.toggle(cells)),
              ),
      ),
      for (final cell in cells)
        SwitchListTile(
          key: ValueKey(('account-notification', category.name, cell.$2.name)),
          contentPadding: const EdgeInsetsDirectional.only(start: 32, end: 24),
          title: AutospacedText(_channelLabel(messages, cell.$2)),
          value: settings.isEnabled(cell),
          onChanged: _saving
              ? null
              : (value) => unawaited(
                  _change(settings, at: category, cells: {cell: value}),
                ),
        ),
      ..._failureAt([category]),
    ];
  }

  /// The failure of the last change, when it is worded under one of [at].
  List<Widget> _failureAt(List<Object> at) {
    final failure = _failure;
    if (failure == null || !at.contains(failure.at)) {
      return const [];
    }
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: AutospacedText(
          failure.message,
          key: ValueKey(
            failure.at == _emailRow
                ? 'account-email-notifications-failure'
                : 'account-notification-preferences-failure',
          ),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ),
    ];
  }

  Widget _section(List<Widget> children) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }

  /// Writes [cells], and [emailEnabled] when given, over [settings] at once,
  /// and saves the result with the email setting it then holds.
  Future<void> _change(
    NotificationSettings settings, {
    required Object at,
    bool? emailEnabled,
    Map<NotificationCell, bool> cells = const {},
  }) async {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    final next = settings.copyWith(emailEnabled: emailEnabled, cells: cells);
    setState(() {
      _settings = next;
      _saving = true;
      _failure = null;
    });
    try {
      final stored = await auth.updateNotificationSettings(
        emailEnabled: next.emailEnabled,
        cells: cells,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _settings = stored;
        _saving = false;
      });
    } on AuthFailure catch (failure) {
      if (!mounted) {
        return;
      }
      // The switches go back to what the account still holds, so trying
      // again is the same tap as the first one.
      setState(() {
        _settings = settings;
        _saving = false;
        _failure = (
          at: at,
          message: failure.kind == AuthFailureKind.network
              ? messages.errorsRpcUnavailable
              : at == _emailRow
              ? messages.accountEmailNotificationsUpdateFailed
              : messages.accountNotificationPreferencesUpdateFailed,
        );
      });
    }
  }
}

String _categoryLabel(AppMessages messages, NotificationCategory category) =>
    switch (category) {
      NotificationCategory.followedEpisodes =>
        messages.accountNotificationCategoryFollowedEpisodes,
      NotificationCategory.followedCreators =>
        messages.accountNotificationCategoryFollowedCreators,
      NotificationCategory.comments =>
        messages.accountNotificationCategoryComments,
      NotificationCategory.announcements =>
        messages.accountNotificationCategoryAnnouncements,
    };

String _channelLabel(AppMessages messages, NotificationChannel channel) =>
    switch (channel) {
      NotificationChannel.inbox => messages.accountNotificationChannelInbox,
      NotificationChannel.webPush => messages.accountNotificationChannelWebPush,
      NotificationChannel.mobilePush =>
        messages.accountNotificationChannelMobilePush,
    };

/// A tristate checkbox and its [label], which turns a group of switches on,
/// or off again when [value] says they are all on already.
class _GroupToggle extends StatelessWidget {
  const _GroupToggle({
    super.key,
    required this.label,
    required this.value,
    required this.onPressed,
  });

  final String label;

  /// `true` when every switch of the group is on, `false` when every one is
  /// off, and `null` when they are mixed.
  final bool? value;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final onPressed = this.onPressed;
    return MergeSemantics(
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsetsDirectional.only(end: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Checkbox(
                tristate: true,
                value: value,
                onChanged: onPressed == null ? null : (_) => onPressed(),
              ),
              Flexible(child: AutospacedText(label)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The birth date the account carries, which is written once: a stored date
/// is shown back, and the way to give one appears only where the tenant checks
/// ages and the reader has given none.
class _BirthDateRow extends StatefulWidget {
  const _BirthDateRow({super.key});

  @override
  State<_BirthDateRow> createState() => _BirthDateRowState();
}

class _BirthDateRowState extends State<_BirthDateRow> {
  late Future<ReaderAge?> _future;
  var _started = false;
  var _saving = false;
  String? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = AuthScope.of(context).readReaderAge();
  }

  void _reload() {
    setState(() {
      _future = AuthScope.of(context).readReaderAge();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<ReaderAge?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _section(
            ListTile(
              key: const ValueKey('account-birth-date-loading'),
              title: AutospacedText(messages.accountBirthDate),
              trailing: const SizedBox.square(
                dimension: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        if (snapshot.hasError) {
          return _section(
            ListTile(
              key: const ValueKey('account-birth-date-error'),
              title: AutospacedText(messages.accountBirthDate),
              subtitle: AutospacedText(messages.accountBirthDateLoadFailed),
              trailing: TextButton(
                onPressed: _reload,
                child: AutospacedText(messages.commonRetry),
              ),
            ),
          );
        }
        final age = snapshot.data;
        if (age == null) {
          return const SizedBox.shrink();
        }
        final stored = parseBirthDate(age.birthDate);
        if (stored != null) {
          // The copy asks a reader with a wrong date to get in touch, so the
          // row leads to where they can.
          final canContact = ContactScope.maybeOf(context) != null;
          return _section(
            ListTile(
              key: const ValueKey('account-birth-date'),
              title: AutospacedText(messages.accountBirthDate),
              subtitle: AutospacedText(
                '${messages.formatCalendarDate(stored)}\n'
                '${messages.accountBirthDateSetHelp}',
              ),
              isThreeLine: true,
              trailing: canContact ? const Icon(Icons.chevron_right) : null,
              onTap: canContact
                  ? () => context.push(AppRoutes.accountContact)
                  : null,
            ),
          );
        }
        if (age.verification == AgeVerification.none) {
          return const SizedBox.shrink();
        }
        return _section(
          ListTile(
            key: const ValueKey('account-birth-date-add'),
            title: AutospacedText(messages.accountBirthDate),
            subtitle: AutospacedText(messages.accountBirthDateHelp),
            trailing: _saving
                ? const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.chevron_right),
            onTap: _saving ? null : () => unawaited(_record(age)),
          ),
          failure: _failure,
        );
      },
    );
  }

  Widget _section(Widget row, {String? failure}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        row,
        if (failure != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: AutospacedText(
              failure,
              key: const ValueKey('account-birth-date-failure'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }

  /// Asks for the date, then for a second look at it, because the account
  /// keeps whatever is saved here for good.
  Future<void> _record(ReaderAge age) async {
    final messages = AppMessages.of(context);
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialEntryMode: DatePickerEntryMode.input,
      initialDatePickerMode: DatePickerMode.year,
      firstDate: DateTime(now.year - 130),
      lastDate: now,
      helpText: messages.accountBirthDate,
    );
    if (picked == null || !mounted) {
      return;
    }
    final birthDate = DateTime.utc(picked.year, picked.month, picked.day);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('account-birth-date-confirm'),
        title: AutospacedText(
          messages.accountBirthDateConfirmTitle(
            date: messages.formatCalendarDate(birthDate),
          ),
        ),
        content: AutospacedText(messages.accountBirthDateConfirmDescription),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: AutospacedText(messages.commonCancel),
          ),
          FilledButton(
            key: const ValueKey('account-birth-date-save'),
            onPressed: () => Navigator.of(context).pop(true),
            child: AutospacedText(messages.accountBirthDateSave),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) {
      return;
    }
    setState(() {
      _saving = true;
      _failure = null;
    });
    final auth = AuthScope.of(context);
    try {
      final stored = await auth.recordBirthDate(birthDate);
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _future = Future.value(
          ReaderAge(
            birthDate: stored,
            timeZone: age.timeZone,
            verification: age.verification,
          ),
        );
      });
    } on AuthFailure catch (failure) {
      if (!mounted) {
        return;
      }
      if (failure.kind == AuthFailureKind.birthDateAlreadySet) {
        // Another device got there first; what the account holds is the answer.
        _saving = false;
        _reload();
        return;
      }
      setState(() {
        _saving = false;
        _failure = switch (failure.kind) {
          AuthFailureKind.birthDateInvalid => messages.accountBirthDateInvalid,
          AuthFailureKind.network => messages.errorsRpcUnavailable,
          _ => messages.accountBirthDateSaveFailed,
        };
      });
    }
  }
}
