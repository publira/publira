import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/coins/buy_coin_pack_button.dart';
import 'package:publira/coins/coin_disclosures_view.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/coins/coin_shop.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/l10n/locale_negotiation.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The tenant's coins, titled with the tenant's own word for them: what the
/// reader holds and when the first of it expires, the packs the store on this
/// device sells at the store's price, the tenant's disclosures, and every
/// entry that added or took coins, newest first.
///
/// A tenant whose app does not sell through the store, or that has coins off,
/// has nothing here: the screen says the page is not found, as the site's
/// does.
class CoinsScreen extends StatefulWidget {
  const CoinsScreen({super.key});

  @override
  State<CoinsScreen> createState() => _CoinsScreenState();
}

/// Where the screen stands with the tenant's coins.
enum _Standing { loading, unavailable, failed, ready }

class _CoinsScreenState extends State<CoinsScreen> {
  var _standing = _Standing.loading;
  CoinShop? _shop;

  CoinBalance? _balance;
  var _balanceFailed = false;

  /// Every page of the history read so far, and `null` while the first is in
  /// flight.
  List<CoinTransaction>? _history;
  var _nextToken = '';
  var _historyFailed = false;
  var _moreFailed = false;

  /// The load ([_reads]) the page under the history is being read for, or
  /// `null` while none is. A page still on its way for an earlier load does
  /// not hold back the history a refresh has just read.
  int? _readingMoreFor;

  /// Counts the reads this screen has started, so an answer meant for the
  /// reader or the locale before this one cannot land on it.
  var _reads = 0;

  var _started = false;
  var _accessToken = '';
  var _locale = '';

  /// The store's recorded packs, heard so that a pack held pending reaches
  /// the balance on screen once the server grants it.
  StreamSubscription<String>? _packsRecorded;
  StorePurchaser? _listenedPurchaser;

  /// Reads everything again whenever the reader or the locale changes: the
  /// balance is the reader's, and the coins are named in the app's language.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final purchaser = PurchaseScope.maybeOf(context)?.storePurchaser;
    if (!identical(purchaser, _listenedPurchaser)) {
      _listenedPurchaser = purchaser;
      unawaited(_packsRecorded?.cancel());
      _packsRecorded = purchaser?.recorded.where(isCoinPackProduct).listen((_) {
        if (mounted) {
          unawaited(_load());
        }
      });
    }
    final accessToken = AuthScope.of(context).accessToken;
    final locale = Localizations.localeOf(context).toLanguageTag();
    if (_started && accessToken == _accessToken && locale == _locale) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _locale = locale;
    unawaited(_load());
  }

  @override
  void dispose() {
    unawaited(_packsRecorded?.cancel());
    super.dispose();
  }

  Future<void> _load() async {
    final read = ++_reads;
    final coins = CoinScope.maybeOf(context);
    final scope = PurchaseScope.maybeOf(context);
    setState(() {
      _standing = _Standing.loading;
    });
    final purchase = scope?.repository;
    if (coins == null || purchase == null || !await appShowsCoins(purchase)) {
      if (mounted && read == _reads) {
        setState(() {
          _standing = _Standing.unavailable;
        });
      }
      return;
    }
    final CoinShop shop;
    try {
      shop = await readCoinShop(
        coins: coins,
        purchase: purchase,
        purchaser: scope?.storePurchaser,
        locale: _locale,
      );
    } on CoinFailure catch (failure) {
      if (mounted && read == _reads) {
        setState(() {
          _standing = failure.kind == CoinFailureKind.unavailable
              ? _Standing.unavailable
              : _Standing.failed;
        });
      }
      return;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _shop = shop;
      _standing = _Standing.ready;
    });
    if (_accessToken.isNotEmpty) {
      await _readReader(coins, read);
    }
  }

  /// The reader's balance and the first page of their history.
  Future<void> _readReader(CoinRepository coins, int read) async {
    setState(() {
      _balance = null;
      _balanceFailed = false;
      _history = null;
      _nextToken = '';
      _historyFailed = false;
      _moreFailed = false;
    });
    final (balance, page) = await (
      coins
          .balance(locale: _locale)
          .then<CoinBalance?>((balance) => balance)
          .onError<CoinFailure>((_, _) => null),
      coins
          .transactions(locale: _locale)
          .then<CoinTransactionPage?>((page) => page)
          .onError<CoinFailure>((_, _) => null),
    ).wait;
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _balance = balance;
      _balanceFailed = balance == null;
      _history = page?.transactions ?? const [];
      _nextToken = page?.nextToken ?? '';
      _historyFailed = page == null;
    });
  }

  /// Asks for the page of the history under the last one, unless it is on its
  /// way, the history ended, or the last attempt failed and waits on a retry.
  void _readMore() {
    final coins = CoinScope.maybeOf(context);
    if (coins == null ||
        _readingMoreFor == _reads ||
        _nextToken.isEmpty ||
        _moreFailed) {
      return;
    }
    final read = _reads;
    _readingMoreFor = read;
    unawaited(() async {
      CoinTransactionPage? page;
      try {
        page = await coins.transactions(locale: _locale, token: _nextToken);
      } on CoinFailure {
        page = null;
      }
      if (_readingMoreFor == read) {
        _readingMoreFor = null;
      }
      if (!mounted || read != _reads) {
        return;
      }
      setState(() {
        if (page == null) {
          _moreFailed = true;
          return;
        }
        _history = [...?_history, ...page.transactions];
        _nextToken = page.nextToken;
      });
    }());
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final shop = _shop;
    final title = _standing == _Standing.ready && shop != null
        ? shop.settings.coinName
        : '';
    return Scaffold(
      appBar: AppBar(title: AutospacedText(title)),
      body: SafeArea(child: _body(messages)),
    );
  }

  Widget _body(AppMessages messages) {
    final shop = _shop;
    switch (_standing) {
      case _Standing.loading:
        return const Center(
          key: ValueKey('coins-loading'),
          child: CircularProgressIndicator(),
        );
      case _Standing.unavailable:
        return _message(
          key: const ValueKey('coins-unavailable'),
          text: messages.notFoundTitle,
        );
      case _Standing.failed:
        return _message(
          key: const ValueKey('coins-failed'),
          text: messages.coinsFailed,
          action: FilledButton(
            onPressed: () => unawaited(_load()),
            child: AutospacedText(messages.commonRetry),
          ),
        );
      case _Standing.ready:
        break;
    }
    final coinName = shop!.settings.coinName;
    if (_accessToken.isEmpty) {
      return _message(
        key: const ValueKey('coins-signed-out'),
        text: messages.coinsSignInPrompt(coinName: coinName),
        action: FilledButton(
          onPressed: () => context.pushInTab(AppRoutes.signIn),
          child: AutospacedText(messages.commonSignIn),
        ),
      );
    }
    final history = _history;
    return RefreshIndicator(
      onRefresh: _load,
      child: ReadableScrollPadding(
        builder: (context, padding) => ListView(
          key: const ValueKey('coins-list'),
          padding: padding,
          children: [
            _heading(messages.coinsBalanceHeading),
            _balanceSection(messages, coinName),
            const Divider(height: 1),
            _heading(messages.coinsPacksHeading(coinName: coinName)),
            ..._packsSection(messages, shop),
            const Divider(height: 1),
            _heading(messages.coinsHistoryHeading),
            if (_historyFailed)
              _message(
                key: const ValueKey('coins-history-failed'),
                text: messages.coinsHistoryFailed,
                action: OutlinedButton(
                  onPressed: () => unawaited(_load()),
                  child: AutospacedText(messages.commonRetry),
                ),
              )
            else if (history == null)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (history.isEmpty)
              Padding(
                key: const ValueKey('coins-history-empty'),
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                child: AutospacedText(
                  messages.coinsHistoryEmpty(coinName: coinName),
                ),
              )
            else ...[
              for (final transaction in history)
                _TransactionRow(transaction: transaction, coinName: coinName),
              if (_moreFailed)
                _message(
                  key: const ValueKey('coins-history-more-failed'),
                  text: messages.coinsMoreHistoryFailed,
                  action: OutlinedButton(
                    onPressed: () {
                      setState(() {
                        _moreFailed = false;
                      });
                      _readMore();
                    },
                    child: AutospacedText(messages.commonRetry),
                  ),
                )
              else if (_nextToken.isNotEmpty)
                // Keyed by the load as well as the page, so every load mounts
                // a footer of its own, which asks for its own next page.
                _MoreHistory(
                  key: ValueKey((_reads, _nextToken)),
                  onShown: _readMore,
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _balanceSection(AppMessages messages, String coinName) {
    final theme = Theme.of(context);
    final balance = _balance;
    if (balance == null) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: _balanceFailed
            ? AutospacedText(
                messages.coinsBalanceFailed,
                key: const ValueKey('coins-balance-failed'),
              )
            : const LinearProgressIndicator(),
      );
    }
    final expiry = balance.nearestExpiryAt;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AutospacedText(
            messages.coinsBalanceValue(
              coinName: coinName,
              count: balance.coins,
            ),
            key: const ValueKey('coins-balance'),
            style: theme.textTheme.headlineSmall,
          ),
          if (expiry != null && balance.nearestExpiryCoins > 0) ...[
            const SizedBox(height: 4),
            AutospacedText(
              messages.coinsNearestExpiry(
                coinName: coinName,
                count: balance.nearestExpiryCoins,
                date: messages.formatDateTime(expiry),
              ),
              key: const ValueKey('coins-nearest-expiry'),
              style: muted,
            ),
          ],
          if (balance.owedCoins > 0) ...[
            const SizedBox(height: 4),
            AutospacedText(
              messages.coinsOwed(coinName: coinName, count: balance.owedCoins),
              key: const ValueKey('coins-owed'),
              style: muted,
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _packsSection(AppMessages messages, CoinShop shop) {
    final theme = Theme.of(context);
    final settings = shop.settings;
    final coinName = settings.coinName;
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final String? unavailable;
    if (!settings.selling) {
      unavailable = messages.coinsPacksNotSelling(coinName: coinName);
    } else if (shop.packs.isEmpty) {
      unavailable = messages.coinsPacksUnavailable(coinName: coinName);
    } else {
      unavailable = null;
    }
    return [
      if (unavailable != null)
        Padding(
          key: const ValueKey('coins-packs-unavailable'),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: AutospacedText(unavailable),
        )
      else ...[
        for (final pack in shop.packs)
          ListTile(
            key: ValueKey('coins-pack-${pack.id}'),
            title: AutospacedText(
              messages.coinsPackTitle(
                bonus: pack.bonusCoins,
                coinName: coinName,
                count: pack.totalCoins,
              ),
            ),
            trailing: BuyCoinPackButton(
              key: ValueKey('coins-pack-buy-${pack.id}'),
              pack: pack,
              coinName: coinName,
              label: messages.purchaseBuy(price: pack.price),
              onChanged: () => unawaited(_load()),
            ),
          ),
        if (settings.expiryDays > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: AutospacedText(
              messages.coinsPackExpiry(
                coinName: coinName,
                days: settings.expiryDays,
              ),
              key: const ValueKey('coins-pack-expiry'),
              style: muted,
            ),
          ),
      ],
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: CoinDisclosuresView(disclosures: settings.disclosures),
      ),
    ];
  }

  Widget _heading(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: AutospacedText(
        text,
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }

  Widget _message({required Key key, required String text, Widget? action}) {
    return Padding(
      key: key,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AutospacedText(text, textAlign: TextAlign.center),
          if (action != null) ...[const SizedBox(height: 16), action],
        ],
      ),
    );
  }
}

/// One entry of the history: what moved the coins, when, and how many. A
/// spend names the episode it paid for and opens it.
class _TransactionRow extends StatelessWidget {
  const _TransactionRow({required this.transaction, required this.coinName});

  final CoinTransaction transaction;
  final String coinName;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final count = transaction.coins;
    final amount = switch (transaction.kind) {
      CoinTransactionKind.grant => messages.coinsAmountAdded(
        coinName: coinName,
        count: count,
      ),
      CoinTransactionKind.shortfall => messages.coinsAmountOwed(
        coinName: coinName,
        count: count,
      ),
      CoinTransactionKind.spend ||
      CoinTransactionKind.revocation ||
      CoinTransactionKind.expiry ||
      CoinTransactionKind.shortfallSettlement => messages.coinsAmountRemoved(
        coinName: coinName,
        count: count,
      ),
    };
    final label = switch (transaction.kind) {
      CoinTransactionKind.grant => messages.coinsKindGrant,
      CoinTransactionKind.spend => messages.coinsKindSpend,
      CoinTransactionKind.revocation => messages.coinsKindRevocation,
      CoinTransactionKind.expiry => messages.coinsKindExpiry,
      CoinTransactionKind.shortfall => messages.coinsKindShortfall,
      CoinTransactionKind.shortfallSettlement => messages.coinsKindSettlement,
    };
    final expiresAt = transaction.expiresAt;
    final opens =
        transaction.seriesId.isNotEmpty && transaction.episodeId.isNotEmpty;
    return ListTile(
      key: ValueKey('coins-transaction-${transaction.id}'),
      title: AutospacedText(label),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (transaction.episodeTitle.isNotEmpty)
            AutospacedText(
              transaction.episodeTitle,
              locale: supportedLocaleForCode(transaction.episodeLocale),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          AutospacedText(messages.formatDateTime(transaction.createdAt)),
          if (transaction.kind == CoinTransactionKind.grant &&
              expiresAt != null)
            AutospacedText(
              messages.coinsGrantExpires(
                date: messages.formatDateTime(expiresAt),
              ),
            ),
        ],
      ),
      trailing: AutospacedText(
        amount,
        style: theme.textTheme.titleSmall?.copyWith(
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
      onTap: opens
          ? () => context.pushInTab(
              AppRoutes.episodeViewerPath(
                transaction.seriesId,
                transaction.episodeId,
              ),
            )
          : null,
    );
  }
}

/// The foot of a history with more under it, which asks for the next page
/// once the reader has scrolled it into view.
class _MoreHistory extends StatefulWidget {
  const _MoreHistory({super.key, required this.onShown});

  final VoidCallback onShown;

  @override
  State<_MoreHistory> createState() => _MoreHistoryState();
}

class _MoreHistoryState extends State<_MoreHistory> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onShown();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(16),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}
