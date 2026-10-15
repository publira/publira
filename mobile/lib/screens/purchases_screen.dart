import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/links/link_scope.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_history_csv.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';
import 'package:publira/typography/autospaced_tooltip.dart';

/// How many rows before the end of the list the page under it is asked for,
/// the same read-ahead the library's lists use.
const _readAheadRows = 5;

/// Every episode the reader has bought, newest purchase first, read from the
/// API rather than from what this device keeps, so a purchase made on the
/// site or on another device is here too.
///
/// A row opens its episode, whether or not the purchase still does. The app
/// bar exports the whole list as the CSV file the site downloads.
class PurchasesScreen extends StatefulWidget {
  const PurchasesScreen({super.key});

  @override
  State<PurchasesScreen> createState() => _PurchasesScreenState();
}

class _PurchasesScreenState extends State<PurchasesScreen> {
  /// Every page read so far as one list, and `null` while the first is still
  /// in flight.
  List<MyPurchase>? _purchases;

  /// What the API calls the page under [_purchases]. Empty at the end of the
  /// list, which is what takes the footer away.
  var _nextToken = '';

  /// The first page's failure, which is the whole screen, and a later page's,
  /// which is the footer under the rows already on screen.
  PurchaseFailure? _failure;
  PurchaseFailure? _moreFailure;

  /// Whether a page is in flight. Set without [setState], so the list can ask
  /// for a page while it builds.
  var _reading = false;

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader before this one cannot land on the list.
  var _reads = 0;

  var _accessToken = '';
  var _started = false;

  /// The pull-to-refresh in progress, completed once the first page it asked
  /// for has answered.
  Completer<void>? _refreshing;

  /// Whether the purchase history is being read for the export, which keeps
  /// a second tap from starting another.
  var _exporting = false;

  /// Reads the list again whenever the reader changes, because what was
  /// bought belongs to whoever holds the session.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _readFirstPage();
  }

  @override
  void dispose() {
    _refreshing?.complete();
    super.dispose();
  }

  void _readFirstPage() {
    setState(() {
      _purchases = null;
      _nextToken = '';
      _failure = null;
      _moreFailure = null;
      _reading = _accessToken.isNotEmpty;
    });
    _reads++;
    if (_accessToken.isEmpty) {
      return;
    }
    unawaited(_read(_reads, ''));
  }

  /// Reads the list again from the top. The screen stays mounted while the
  /// reader is on another tab, so a purchase made meanwhile appears only
  /// once they ask for it.
  Future<void> _refresh() {
    final pending = Completer<void>();
    _refreshing?.complete();
    _refreshing = pending;
    _readFirstPage();
    return pending.future;
  }

  /// Asks for the page under the last one, unless it is already on its way,
  /// the list ended, or the last attempt at it failed and is waiting on the
  /// footer's retry.
  void _readMore() {
    if (_reading || _nextToken.isEmpty || _moreFailure != null) {
      return;
    }
    _reading = true;
    unawaited(_read(++_reads, _nextToken));
  }

  /// Reads every purchase afresh rather than the pages already on screen, so
  /// the file holds the whole history as it stands, a refund recorded a
  /// moment ago included, and hands it to the share sheet.
  Future<void> _export() async {
    final repository = PurchaseScope.repositoryOf(context);
    final share = LinkScope.maybeOf(context)?.share;
    if (repository == null || share == null || _exporting) {
      return;
    }
    final messages = AppMessages.of(context);
    final messenger = ScaffoldMessenger.of(context);
    void reportFailure(String message) => messenger.showSnackBar(
      SnackBar(
        key: const ValueKey('purchases-export-failed'),
        content: AutospacedText(message),
      ),
    );
    final accessToken = _accessToken;
    setState(() => _exporting = true);
    try {
      final purchases = <MyPurchase>[];
      var token = '';
      do {
        final page = await repository.listMyPurchases(
          token: token,
          limit: myPurchasePageLimitMax,
        );
        // A reader who signed out or changed account meanwhile is not handed
        // pages that belong to someone else.
        if (!mounted || accessToken != _accessToken) {
          return;
        }
        purchases.addAll(page.purchases);
        token = page.nextToken;
      } while (token.isNotEmpty);
      await share.shareFile(
        bytes: utf8.encode(renderPurchaseHistoryCsv(purchases)),
        name: purchaseHistoryCsvName,
        mimeType: 'text/csv',
        title: messages.purchasesTitle,
      );
    } on PurchaseFailure catch (failure) {
      reportFailure(switch (failure.kind) {
        PurchaseFailureKind.network => messages.errorsRpcUnavailable,
        PurchaseFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
        _ => messages.purchasesExportFailed,
      });
    } on PlatformException {
      // The share sheet could not be opened, so the file reached no one.
      reportFailure(messages.purchasesExportFailed);
    } finally {
      if (mounted) {
        setState(() => _exporting = false);
      }
    }
  }

  Future<void> _read(int read, String token) async {
    final repository = PurchaseScope.repositoryOf(context);
    if (repository == null) {
      return;
    }
    final isFirstPage = token.isEmpty;
    MyPurchasePage? page;
    PurchaseFailure? failure;
    try {
      page = await repository.listMyPurchases(token: token);
    } on PurchaseFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    if (isFirstPage) {
      _refreshing?.complete();
      _refreshing = null;
    }
    setState(() {
      _reading = false;
      if (page == null) {
        // A session the API refuses is refused for every page, so it takes the
        // whole screen, where the way out is to sign in again.
        if (isFirstPage ||
            failure?.kind == PurchaseFailureKind.sessionExpired) {
          _failure = failure;
        } else {
          _moreFailure = failure;
        }
        return;
      }
      _purchases = [if (!isFirstPage) ...?_purchases, ...page.purchases];
      _nextToken = page.nextToken;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final purchases = _purchases;
    final canExport =
        LinkScope.maybeOf(context)?.share != null &&
        _failure == null &&
        purchases != null &&
        purchases.isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: AutospacedText(messages.purchasesTitle),
        actions: [
          if (canExport)
            AutospacedTooltip(
              message: messages.purchasesExportCsv,
              child: IconButton(
                key: const ValueKey('purchases-export'),
                onPressed: _exporting ? null : _export,
                icon: _exporting
                    ? const SizedBox.square(
                        dimension: 24,
                        child: Padding(
                          padding: EdgeInsets.all(2),
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : const Icon(Icons.file_download_outlined),
              ),
            ),
        ],
      ),
      body: SafeArea(child: _buildList(context)),
    );
  }

  Widget _buildList(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return CatalogMessage(
        key: const ValueKey('purchases-signed-out'),
        message: messages.purchasesSignInPrompt,
        actionKey: const ValueKey('purchases-sign-in'),
        actionLabel: messages.commonSignIn,
        onAction: () => context.pushInTab(AppRoutes.signIn),
      );
    }
    final failure = _failure;
    if (failure != null) {
      // Retrying would send the token the API just refused.
      final signIn = failure.kind == PurchaseFailureKind.sessionExpired;
      return CatalogMessage(
        key: const ValueKey('purchases-error'),
        message: _failureCopy(messages, failure),
        actionKey: ValueKey(signIn ? 'purchases-sign-in' : 'purchases-retry'),
        actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
        onAction: signIn
            ? () => context.pushInTab(AppRoutes.signIn)
            : _readFirstPage,
      );
    }
    final purchases = _purchases;
    if (purchases == null) {
      return const Padding(
        key: ValueKey('purchases-loading'),
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final hasFooter = _nextToken.isNotEmpty || _moreFailure != null;
    if (purchases.isEmpty && !hasFooter) {
      return RefreshIndicator(
        onRefresh: _refresh,
        // Scrollable so the pull that reads the list again still starts.
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            CatalogMessage(
              key: const ValueKey('purchases-empty'),
              message: messages.purchasesEmpty,
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ReadableScrollPadding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        builder: (context, padding) => ListView.separated(
          key: const ValueKey('purchases-list'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: padding,
          itemCount: purchases.length + (hasFooter ? 1 : 0),
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= purchases.length - _readAheadRows) {
              _readMore();
            }
            if (index == purchases.length) {
              return _PurchasesPageFooter(
                message: _moreFailure == null
                    ? null
                    : _failureCopy(messages, _moreFailure!),
                onRetry: () {
                  setState(() {
                    _moreFailure = null;
                  });
                  _readMore();
                },
              );
            }
            return _PurchaseRow(purchase: purchases[index]);
          },
        ),
      ),
    );
  }

  String _failureCopy(AppMessages messages, PurchaseFailure failure) {
    return switch (failure.kind) {
      PurchaseFailureKind.network => messages.errorsRpcUnavailable,
      PurchaseFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
      PurchaseFailureKind.alreadyPurchased ||
      PurchaseFailureKind.gone ||
      PurchaseFailureKind.storeUnavailable ||
      PurchaseFailureKind.notSold ||
      PurchaseFailureKind.notSettled ||
      PurchaseFailureKind.unexpected => messages.purchasesFailed,
    };
  }
}

class _PurchaseRow extends StatelessWidget {
  const _PurchaseRow({required this.purchase});

  final MyPurchase purchase;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final expiresAt = purchase.expiresAt;
    final status = purchase.status;
    final details = <String>[
      if (purchase.purchasedAt case final purchasedAt?)
        messages.purchasesPurchasedAt(
          date: messages.formatDateTime(purchasedAt),
        ),
      if (purchase.currency.isNotEmpty)
        messages.purchasesPrice(
          price: messages.formatPrice(purchase.price, purchase.currency),
        ),
      // A refunded or canceled purchase closed before its reading period
      // ran out, so neither the period nor its end says when it stopped.
      ...switch (status) {
        MyPurchaseStatus.refunded || MyPurchaseStatus.canceled => const [],
        _ when expiresAt == null => [messages.purchasesNoExpiry],
        MyPurchaseStatus.active => [
          messages.purchasesReadableUntil(
            date: messages.formatDateTime(expiresAt),
          ),
        ],
        MyPurchaseStatus.expired => [
          messages.purchasesEndedAt(date: messages.formatDateTime(expiresAt)),
        ],
      },
    ];
    final title = [
      '#${messages.formatInteger(purchase.orderIndex)}',
      if (purchase.episodeTitle.isNotEmpty) purchase.episodeTitle,
    ].join(' ');
    return ListTile(
      key: ValueKey('purchase-row-${purchase.id}'),
      isThreeLine: true,
      title: AutospacedText(
        title,
        style: purchase.isActive ? null : TextStyle(color: muted),
      ),
      subtitle: AutospacedText(
        [
          if (purchase.seriesTitle.isNotEmpty) purchase.seriesTitle,
          details.join(' · '),
        ].join('\n'),
      ),
      trailing: _PurchaseState(status: status),
      onTap: () => context.pushInTab(
        AppRoutes.episodeViewerPath(purchase.seriesId, purchase.episodeId),
      ),
    );
  }
}

/// Whether a purchase still opens its episode, and why not when it does not,
/// in a word and in a colour, so an ended rental does not read as something
/// the reader can open, nor a refund as a rental that ran out.
class _PurchaseState extends StatelessWidget {
  const _PurchaseState({required this.status});

  final MyPurchaseStatus status;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final colors = Theme.of(context).colorScheme;
    final isActive = status == MyPurchaseStatus.active;
    return Chip(
      key: ValueKey(switch (status) {
        MyPurchaseStatus.active => 'purchase-readable',
        MyPurchaseStatus.expired => 'purchase-expired',
        MyPurchaseStatus.refunded => 'purchase-refunded',
        MyPurchaseStatus.canceled => 'purchase-canceled',
      }),
      label: AutospacedText(switch (status) {
        MyPurchaseStatus.active => messages.purchasesReadable,
        MyPurchaseStatus.expired => messages.purchasesExpired,
        MyPurchaseStatus.refunded => messages.purchasesRefunded,
        MyPurchaseStatus.canceled => messages.purchasesCanceled,
      }),
      backgroundColor: isActive
          ? colors.primaryContainer
          : colors.surfaceContainerHighest,
      labelStyle: TextStyle(
        color: isActive ? colors.onPrimaryContainer : colors.onSurfaceVariant,
      ),
      side: BorderSide.none,
      visualDensity: VisualDensity.compact,
    );
  }
}

/// The page under the list: a spinner while it is being read, and what went
/// wrong when it could not be.
class _PurchasesPageFooter extends StatelessWidget {
  const _PurchasesPageFooter({required this.message, required this.onRetry});

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = this.message;
    if (message == null) {
      return const Padding(
        key: ValueKey('purchases-more-loading'),
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: RetryRow(
        sectionKey: 'purchases-more',
        message: message,
        onRetry: onRetry,
      ),
    );
  }
}
