import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// "Buy for [price]": buys one episode the way the tenant's app sells it — the web
/// checkout handed to the system browser, or the store's payment sheet.
///
/// Given [rentalPeriodHours], it is "Rent for [rentalPeriodHours] ([price])"
/// instead, and rents the episode through the web checkout. The store sells
/// the permanent copy alone, so a rental is offered on the external-checkout
/// route only.
///
/// A guest is sent to sign in first, because a purchase is bought by an
/// account. The return from the browser is a link the app routes, not
/// something this button waits for; the payment sheet is.
class BuyEpisodeButton extends StatefulWidget {
  const BuyEpisodeButton({
    super.key,
    required this.episodeId,
    required this.episodeInternalId,
    required this.price,
    required this.currency,
    required this.onAlreadyPurchased,
    required this.onStorePurchase,
    this.rentalPeriodHours,
    this.signInReturnTo,
    this.compact = false,
  });

  final String episodeId;

  /// Internal id of [episodeId], which the purchase requests take.
  final String episodeInternalId;

  /// What the sale costs: the permanent copy's price, its campaign price while
  /// one is open, or the rental's. It is only what the button says; the
  /// checkout and the store charge whatever price they resolve themselves.
  final int price;

  /// The ISO 4217 code of the currency [price] is in, the tenant's.
  final String currency;

  /// The reader already holds the episode, so there was nothing to pay for.
  final VoidCallback onAlreadyPurchased;

  /// The store took the payment, or holds it for approval: the episode is
  /// opened the way a checkout the browser hands back opens it.
  final VoidCallback onStorePurchase;

  /// How long the rental opens the episode, set on a button that rents it
  /// rather than buys it.
  final int? rentalPeriodHours;

  /// Where a guest lands once signed in. `null` goes back to the screen that
  /// sent them, which is right when that screen is the episode itself.
  final String? signInReturnTo;

  /// A row's size rather than a screen's. A row offers no rental, so a button
  /// that rents is always a screen's.
  final bool compact;

  @override
  State<BuyEpisodeButton> createState() => _BuyEpisodeButtonState();
}

class _BuyEpisodeButtonState extends State<BuyEpisodeButton> {
  var _starting = false;

  Future<void> _buy() async {
    final purchase = PurchaseScope.maybeOf(context);
    if (purchase == null || _starting) {
      return;
    }
    if (!AuthScope.of(context).isSignedIn) {
      _signIn();
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    setState(() {
      _starting = true;
    });
    try {
      final repository = purchase.repository!;
      final kind = widget.rentalPeriodHours == null
          ? PurchaseKind.purchase
          : PurchaseKind.rental;
      if (await repository.appPurchaseRoute() == AppPurchaseRoute.store) {
        // The tenant moved to the store route after the rental was offered.
        if (kind == PurchaseKind.rental) {
          throw const PurchaseFailure(PurchaseFailureKind.notSold);
        }
        final purchaser = purchase.storePurchaser;
        if (purchaser == null) {
          throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
        }
        final outcome = await purchaser.buy(widget.episodeInternalId);
        if (mounted && outcome != StorePurchaseOutcome.cancelled) {
          widget.onStorePurchase();
        }
        return;
      }
      final url = await repository.startEpisodeCheckout(
        widget.episodeInternalId,
        locale: locale,
        kind: kind,
      );
      final opened = await purchase.launcher!.open(url);
      if (!opened) {
        messenger.showSnackBar(
          SnackBar(content: AutospacedText(messages.purchaseStartFailed)),
        );
      }
    } on PurchaseFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        case PurchaseFailureKind.alreadyPurchased:
          widget.onAlreadyPurchased();
        case PurchaseFailureKind.sessionExpired:
          _signIn();
        case PurchaseFailureKind.network:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.errorsRpcUnavailable)),
          );
        case PurchaseFailureKind.storeUnavailable:
          messenger.showSnackBar(
            SnackBar(
              content: AutospacedText(messages.purchaseStoreUnavailable),
            ),
          );
        case PurchaseFailureKind.notSold:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.purchaseNotSoldInApp)),
          );
        case PurchaseFailureKind.gone ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.unexpected:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.purchaseStartFailed)),
          );
      }
    } finally {
      if (mounted) {
        setState(() {
          _starting = false;
        });
      }
    }
  }

  void _signIn() {
    unawaited(
      context.pushInTab(AppRoutes.signInPath(returnTo: widget.signInReturnTo)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final price = messages.formatPrice(widget.price, widget.currency);
    final rentalPeriodHours = widget.rentalPeriodHours;
    final label = AutospacedText(
      rentalPeriodHours == null
          ? messages.purchaseBuy(price: price)
          : messages.purchaseRentFor(
              period: messages.purchaseRentalPeriod(hours: rentalPeriodHours),
              price: price,
            ),
    );
    final key = ValueKey(
      rentalPeriodHours == null
          ? 'episode-buy-${widget.episodeId}'
          : 'episode-rent-${widget.episodeId}',
    );
    final onPressed = _starting ? null : () => unawaited(_buy());
    // The rental is the alternative to the permanent copy, so it stands
    // beside it in outline.
    if (rentalPeriodHours != null) {
      return OutlinedButton(key: key, onPressed: onPressed, child: label);
    }
    if (widget.compact) {
      return FilledButton.tonal(
        key: key,
        style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
        onPressed: onPressed,
        child: label,
      );
    }
    return FilledButton(key: key, onPressed: onPressed, child: label);
  }
}
