import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';

/// "Buy for ¥N": buys one episode the way the tenant's app sells it — the web
/// checkout handed to the system browser, or the store's payment sheet.
///
/// A guest is sent to sign in first, because a purchase is bought by an
/// account. The return from the browser is a link the app routes, not
/// something this button waits for; the payment sheet is.
class BuyEpisodeButton extends StatefulWidget {
  const BuyEpisodeButton({
    super.key,
    required this.episodeId,
    required this.price,
    required this.onAlreadyPurchased,
    required this.onStorePurchase,
    this.signInReturnTo,
    this.compact = false,
  });

  final String episodeId;
  final int price;

  /// The reader already holds the episode, so there was nothing to pay for.
  final VoidCallback onAlreadyPurchased;

  /// The store took the payment, or holds it for approval: the episode is
  /// opened the way a checkout the browser hands back opens it.
  final VoidCallback onStorePurchase;

  /// Where a guest lands once signed in. `null` goes back to the screen that
  /// sent them, which is right when that screen is the episode itself.
  final String? signInReturnTo;

  /// A row's size rather than a screen's.
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
    setState(() {
      _starting = true;
    });
    try {
      final repository = purchase.repository!;
      if (await repository.appPurchaseRoute() == AppPurchaseRoute.store) {
        final purchaser = purchase.storePurchaser;
        if (purchaser == null) {
          throw const PurchaseFailure(PurchaseFailureKind.storeUnavailable);
        }
        final outcome = await purchaser.buy(widget.episodeId);
        if (mounted && outcome != StorePurchaseOutcome.cancelled) {
          widget.onStorePurchase();
        }
        return;
      }
      final url = await repository.startEpisodeCheckout(widget.episodeId);
      final opened = await purchase.launcher!.open(url);
      if (!opened) {
        messenger.showSnackBar(
          SnackBar(content: Text(messages.purchaseStartFailed)),
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
            SnackBar(content: Text(messages.errorsRpcUnavailable)),
          );
        case PurchaseFailureKind.storeUnavailable:
          messenger.showSnackBar(
            SnackBar(content: Text(messages.purchaseStoreUnavailable)),
          );
        case PurchaseFailureKind.notSold:
          messenger.showSnackBar(
            SnackBar(content: Text(messages.purchaseNotSoldInApp)),
          );
        case PurchaseFailureKind.gone ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.unexpected:
          messenger.showSnackBar(
            SnackBar(content: Text(messages.purchaseStartFailed)),
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
    final label = Text(
      messages.purchaseBuy(price: '¥${messages.formatInteger(widget.price)}'),
    );
    final onPressed = _starting ? null : () => unawaited(_buy());
    if (widget.compact) {
      return FilledButton.tonal(
        key: ValueKey('episode-buy-${widget.episodeId}'),
        style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
        onPressed: onPressed,
        child: label,
      );
    }
    return FilledButton(
      key: ValueKey('episode-buy-${widget.episodeId}'),
      onPressed: onPressed,
      child: label,
    );
  }
}
