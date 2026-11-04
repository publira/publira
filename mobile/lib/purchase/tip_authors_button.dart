import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The store product a tip of [amount], in the minor unit of the tenant
/// currency, is sold as: `tip_` followed by the amount, as
/// `StartStoreTipResponse.product_id` names it.
String tipProductId(int amount) => 'tip_$amount';

/// **Tip the Authors**: opens [TipAmountsSheet] and gives the Authors of an
/// episode the amount the reader picks there, the way the tenant's app takes
/// a payment — the store's payment sheet, or the web checkout handed to the
/// system browser.
///
/// A guest is sent to sign in first, because a tip is given by an account. A
/// tip the store took is thanked for here; one paid in the browser is
/// thanked for by the screen its return link opens.
class TipAuthorsButton extends StatefulWidget {
  const TipAuthorsButton({
    super.key,
    required this.episodeInternalId,
    required this.creators,
    required this.amounts,
    required this.currency,
  });

  /// Internal id of the episode, which the tip requests take.
  final String episodeInternalId;

  /// The Authors the episode credits, whom the sheet names.
  final List<SeriesCreator> creators;

  /// The tenant's tip amounts, in the minor unit of [currency], never empty.
  final List<int> amounts;

  /// The ISO 4217 code of the tenant's currency.
  final String currency;

  @override
  State<TipAuthorsButton> createState() => _TipAuthorsButtonState();
}

class _TipAuthorsButtonState extends State<TipAuthorsButton> {
  var _tipping = false;

  /// Asks the tenant's purchase route, reads what the store charges for each
  /// amount where the app sells through it, opens the sheet, and gives the
  /// amount the reader picks.
  Future<void> _open() async {
    final purchase = PurchaseScope.maybeOf(context);
    if (purchase == null || _tipping) {
      return;
    }
    if (!AuthScope.of(context).isSignedIn) {
      _signIn();
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    void tell(String message) =>
        messenger.showSnackBar(SnackBar(content: AutospacedText(message)));
    setState(() {
      _tipping = true;
    });
    try {
      final repository = purchase.repository!;
      final route = await repository.appPurchaseRoute();
      final purchaser = purchase.storePurchaser;
      if (route == AppPurchaseRoute.store && purchaser == null) {
        throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
      }
      // The store charges its own price for each product, in the reader's
      // storefront, so that is the price the sheet names. An amount the store
      // has no product for keeps the tenant's, and says it cannot be given
      // once picked.
      final storePrices = route == AppPurchaseRoute.store
          ? await purchaser!.prices({
              for (final amount in widget.amounts) tipProductId(amount),
            })
          : const <String, String>{};
      if (!mounted) {
        return;
      }
      final amount = await showModalBottomSheet<int>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (context) => TipAmountsSheet(
          creators: widget.creators,
          amounts: widget.amounts,
          currency: widget.currency,
          storePrices: storePrices,
        ),
      );
      if (amount == null || !mounted) {
        return;
      }
      if (route == AppPurchaseRoute.store) {
        final outcome = await purchaser!.buyTip(
          widget.episodeInternalId,
          amount: amount,
        );
        switch (outcome) {
          case StorePurchaseOutcome.purchased:
            tell(messages.tipThanks);
          case StorePurchaseOutcome.pending:
            tell(messages.tipPending);
          case StorePurchaseOutcome.cancelled:
            break;
        }
        return;
      }
      final url = await repository.startTipCheckout(
        widget.episodeInternalId,
        amount: amount,
        locale: locale,
      );
      if (!await purchase.launcher!.open(url)) {
        tell(messages.tipStartFailed);
      }
    } on PurchaseFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        case PurchaseFailureKind.sessionExpired:
          _signIn();
        case PurchaseFailureKind.network:
          tell(messages.errorsRpcUnavailable);
        case PurchaseFailureKind.storeUnavailable:
          tell(messages.purchaseStoreUnavailable);
        case PurchaseFailureKind.notSold:
          tell(messages.tipNotSoldInApp);
        case PurchaseFailureKind.alreadyPurchased ||
            PurchaseFailureKind.gone ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.otherAccount ||
            PurchaseFailureKind.unexpected:
          tell(messages.tipStartFailed);
      }
    } finally {
      if (mounted) {
        setState(() {
          _tipping = false;
        });
      }
    }
  }

  /// Back to the episode once signed in, which is the screen that sent them.
  void _signIn() {
    unawaited(context.pushInTab(AppRoutes.signInPath()));
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return OutlinedButton.icon(
      key: const ValueKey('episode-end-tip'),
      style: OutlinedButton.styleFrom(
        foregroundColor: Colors.white,
        side: const BorderSide(color: Colors.white24),
      ),
      onPressed: _tipping ? null : () => unawaited(_open()),
      icon: const Icon(Icons.volunteer_activism_outlined),
      label: AutospacedText(messages.tipButton),
    );
  }
}

/// The tenant's tip amounts, each a button that closes the sheet with it,
/// under the Authors the tip goes to and what a tip is.
class TipAmountsSheet extends StatelessWidget {
  const TipAmountsSheet({
    super.key,
    required this.creators,
    required this.amounts,
    required this.currency,
    this.storePrices = const {},
  });

  final List<SeriesCreator> creators;
  final List<int> amounts;
  final String currency;

  /// What the store charges for each amount's product, formatted by the store
  /// and keyed by [tipProductId], where the app sells through one. An amount
  /// missing here is named in [currency].
  final Map<String, String> storePrices;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    // One person credited in two roles is one Author to give to.
    final names = <String>{
      for (final creator in creators)
        if (creator.name.isNotEmpty) creator.name,
    }.toList();
    return SingleChildScrollView(
      key: const ValueKey('tip-sheet'),
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutospacedText(
            messages.tipSheetTitle,
            style: theme.textTheme.titleLarge,
          ),
          if (names.isNotEmpty) ...[
            const SizedBox(height: 8),
            AutospacedText(
              key: const ValueKey('tip-sheet-authors'),
              messages.tipSheetAuthors(authors: messages.formatList(names)),
              style: theme.textTheme.titleSmall,
            ),
          ],
          const SizedBox(height: 8),
          AutospacedText(
            messages.tipSheetDescription,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final amount in amounts)
                FilledButton.tonal(
                  key: ValueKey('tip-amount-$amount'),
                  onPressed: () => Navigator.of(context).pop(amount),
                  child: AutospacedText(
                    storePrices[tipProductId(amount)] ??
                        messages.formatPrice(amount, currency),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
