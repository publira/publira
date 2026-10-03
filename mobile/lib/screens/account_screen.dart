import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/reader_age.dart';
import 'package:publira/contact/contact_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
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
            ? ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      children: [
                        AutospacedText(messages.accountSignedOut),
                        const SizedBox(height: 16),
                        FilledButton(
                          key: const ValueKey('account-sign-in'),
                          onPressed: () => context.pushInTab(AppRoutes.signIn),
                          child: AutospacedText(messages.commonSignIn),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  const _ContactEntry(),
                ],
              )
            : ListView(
                key: const ValueKey('account-list'),
                children: [
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
                    onTap: () => context.push(AppRoutes.accountReadingHistory),
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
                    onTap: () => context.push(AppRoutes.accountLinkedAccounts),
                  ),
                  const Divider(height: 1),
                  const _NotificationSwitch(),
                  _EmailNotificationSwitch(key: ValueKey(session.userPublicId)),
                  const _ContactEntry(),
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: OutlinedButton(
                      key: const ValueKey('account-sign-out'),
                      // The unregister needs the session, so the device comes
                      // off the delivery list before the session goes away.
                      onPressed: () => unawaited(_signOut(context)),
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

/// Notification email, which the account holds rather than the device, so the
/// storefront's notification settings read and write the same setting.
///
/// Keyed by the reader, so another account signing in reads its own setting
/// rather than showing the last one's.
class _EmailNotificationSwitch extends StatefulWidget {
  const _EmailNotificationSwitch({super.key});

  @override
  State<_EmailNotificationSwitch> createState() =>
      _EmailNotificationSwitchState();
}

class _EmailNotificationSwitchState extends State<_EmailNotificationSwitch> {
  late Future<bool?> _future;
  var _started = false;

  /// The setting the switch shows once it has been read, which a change the
  /// reader makes moves at once and a refused one moves back.
  bool? _enabled;
  var _saving = false;
  String? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = AuthScope.of(context).readEmailNotifications();
  }

  void _reload() {
    setState(() {
      _future = AuthScope.of(context).readEmailNotifications();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<bool?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _section(
            ListTile(
              key: const ValueKey('account-email-notifications-loading'),
              title: AutospacedText(messages.accountEmailNotifications),
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
              key: const ValueKey('account-email-notifications-error'),
              title: AutospacedText(messages.accountEmailNotifications),
              subtitle: AutospacedText(
                messages.accountEmailNotificationsLoadFailed,
              ),
              trailing: TextButton(
                key: const ValueKey('account-email-notifications-retry'),
                onPressed: _reload,
                child: AutospacedText(messages.commonRetry),
              ),
            ),
          );
        }
        final stored = snapshot.data;
        if (stored == null) {
          return const SizedBox.shrink();
        }
        return _section(
          SwitchListTile(
            key: const ValueKey('account-email-notifications'),
            title: AutospacedText(messages.accountEmailNotifications),
            subtitle: AutospacedText(
              messages.accountEmailNotificationsDescription,
            ),
            value: _enabled ?? stored,
            onChanged: _saving ? null : (value) => unawaited(_update(value)),
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
              key: const ValueKey('account-email-notifications-failure'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }

  Future<void> _update(bool enabled) async {
    final messages = AppMessages.of(context);
    final auth = AuthScope.of(context);
    final previous = _enabled;
    setState(() {
      _enabled = enabled;
      _saving = true;
      _failure = null;
    });
    try {
      final stored = await auth.updateEmailNotifications(enabled: enabled);
      if (!mounted) {
        return;
      }
      setState(() {
        _enabled = stored;
        _saving = false;
      });
    } on AuthFailure catch (failure) {
      if (!mounted) {
        return;
      }
      // The switch goes back to what the account still holds, so trying again
      // is the same tap as the first one.
      setState(() {
        _enabled = previous;
        _saving = false;
        _failure = failure.kind == AuthFailureKind.network
            ? messages.errorsRpcUnavailable
            : messages.accountEmailNotificationsUpdateFailed;
      });
    }
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
