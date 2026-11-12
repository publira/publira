import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/payment_lock.dart';
import 'package:publira/purchase/promotion_code.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The widest a row's button gets. A row is a `ListTile`, which refuses a
/// trailing widget that leaves its title no room, so a long label such as one
/// saying the price includes tax wraps instead, on any phone and text size.
const _compactMaxWidth = 144.0;

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
    this.taxIncluded = false,
    this.listPrice,
    this.promotionCode = '',
    this.onPromotionCodeRefused,
    this.rentalPeriodHours,
    this.signInReturnTo,
    this.compact = false,
    this.outlined = false,
    this.lock,
  });

  final String episodeId;

  /// Internal id of [episodeId], which the purchase requests take.
  final String episodeInternalId;

  /// What the sale costs: the permanent copy's price, its campaign price while
  /// one is open, or the rental's, less the discount of [promotionCode]. It is
  /// only what the button says; the checkout and the store charge whatever
  /// price they resolve themselves.
  final int price;

  /// The ISO 4217 code of the currency [price] is in, the tenant's.
  final String currency;

  /// The reader already holds the episode, so there was nothing to pay for,
  /// and they are shown it instead.
  final VoidCallback onAlreadyPurchased;

  /// The store took the payment, or holds it for approval: the episode is
  /// opened the way a checkout the browser hands back opens it.
  final VoidCallback onStorePurchase;

  /// Whether the tenant states a tax rate, so the price says it includes tax.
  final bool taxIncluded;

  /// The price [promotionCode] was taken off, which the button strikes
  /// through beside [price]. `null` without a code.
  final int? listPrice;

  /// The code the purchase is started with, empty without one. The screen that
  /// owns the field hands it over with the [price] it quoted.
  final String promotionCode;

  /// The purchase was refused for [promotionCode], which has stopped working
  /// since it was quoted, for this `PurchaseFailureKind`.
  final ValueChanged<PurchaseFailureKind>? onPromotionCodeRefused;

  /// How long the rental opens the episode, set on a button that rents it
  /// rather than buys it.
  final int? rentalPeriodHours;

  /// Where a guest lands once signed in. `null` goes back to the screen that
  /// sent them, which is right when that screen is the episode itself.
  final String? signInReturnTo;

  /// A row's size rather than a screen's. A row offers no rental, so a button
  /// that rents is always a screen's.
  final bool compact;

  /// Whether another way in leads, such as coins that pay for the episode,
  /// so the purchase stands beside it in outline.
  final bool outlined;

  /// Shared with the other ways the screen offers to pay for the episode, so
  /// only one of them runs at a time.
  final PaymentLock? lock;

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
    final lock = widget.lock;
    if (lock != null && !lock.acquire()) {
      return;
    }
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
        final outcome = await purchaser.buy(
          widget.episodeInternalId,
          promotionCode: widget.promotionCode,
        );
        if (mounted && outcome != StorePurchaseOutcome.cancelled) {
          widget.onStorePurchase();
        }
        return;
      }
      final url = await repository.startEpisodeCheckout(
        widget.episodeInternalId,
        locale: locale,
        kind: kind,
        promotionCode: widget.promotionCode,
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
        case PurchaseFailureKind.promotionCodeInvalid ||
            PurchaseFailureKind.promotionCodeExpired ||
            PurchaseFailureKind.promotionCodeExhausted ||
            PurchaseFailureKind.promotionCodeAlreadyRedeemed ||
            PurchaseFailureKind.promotionCodeNotApplicable ||
            PurchaseFailureKind.promotionCodeNotInApp:
          widget.onPromotionCodeRefused?.call(failure.kind);
        case PurchaseFailureKind.gone ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.otherAccount ||
            PurchaseFailureKind.promotionCodeRateLimited ||
            PurchaseFailureKind.unexpected:
          messenger.showSnackBar(
            SnackBar(content: AutospacedText(messages.purchaseStartFailed)),
          );
      }
    } finally {
      lock?.release();
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
    final lock = widget.lock;
    if (lock == null) {
      return _button(context);
    }
    return ListenableBuilder(
      listenable: lock,
      builder: (context, _) => _button(context),
    );
  }

  Widget _button(BuildContext context) {
    final messages = AppMessages.of(context);
    final price = messages.formatPrice(widget.price, widget.currency);
    final rentalPeriodHours = widget.rentalPeriodHours;
    final text = switch ((rentalPeriodHours, widget.taxIncluded)) {
      (null, false) => messages.purchaseBuy(price: price),
      (null, true) => messages.purchaseBuyTaxIncluded(price: price),
      (final hours?, false) => messages.purchaseRentFor(
        period: messages.purchaseRentalPeriod(hours: hours),
        price: price,
      ),
      (final hours?, true) => messages.purchaseRentForTaxIncluded(
        period: messages.purchaseRentalPeriod(hours: hours),
        price: price,
      ),
    };
    final listPrice = widget.listPrice;
    final label = listPrice == null
        ? AutospacedText(text, textAlign: TextAlign.center)
        : DiscountedButtonLabel(
            label: text,
            listPrice: messages.formatPrice(listPrice, widget.currency),
          );
    final key = ValueKey(
      rentalPeriodHours == null
          ? 'episode-buy-${widget.episodeId}'
          : 'episode-rent-${widget.episodeId}',
    );
    final onPressed = _starting || (widget.lock?.held ?? false)
        ? null
        : () => unawaited(_buy());
    // The rental is the alternative to the permanent copy, so it stands
    // beside it in outline, as the permanent copy does beside a way in that
    // leads.
    if (rentalPeriodHours != null || widget.outlined) {
      return OutlinedButton(key: key, onPressed: onPressed, child: label);
    }
    if (widget.compact) {
      return ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: _compactMaxWidth),
        child: FilledButton.tonal(
          key: key,
          style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
          onPressed: onPressed,
          child: label,
        ),
      );
    }
    return FilledButton(key: key, onPressed: onPressed, child: label);
  }
}
