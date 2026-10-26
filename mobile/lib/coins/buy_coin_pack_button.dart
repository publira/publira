import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/coins/coin_shop.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/payment_lock.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Buys [pack] with the store's payment sheet, as a consumable the server
/// grants once it has recorded the transaction.
///
/// The reader is told their coins were added once the server has them, or
/// that the payment is being confirmed when the store or the server cannot
/// settle it yet; either way [onChanged] reads the balance again, as it does
/// for a pack the tenant no longer sells. A sheet the reader closed changes
/// nothing.
class BuyCoinPackButton extends StatefulWidget {
  const BuyCoinPackButton({
    super.key,
    required this.pack,
    required this.coinName,
    required this.label,
    required this.onChanged,
    this.outlined = false,
    this.lock,
  });

  final StoreCoinPack pack;

  /// The tenant's word for its coins, which every message here names them by.
  final String coinName;

  final String label;

  /// The store took the payment or holds it for approval, or the pack turned
  /// out not to be on sale any more.
  final VoidCallback onChanged;

  /// Whether the button stands beside a way in that leads, in outline.
  final bool outlined;

  /// Shared with the other payments the screen offers, so only one of them
  /// runs at a time.
  final PaymentLock? lock;

  @override
  State<BuyCoinPackButton> createState() => _BuyCoinPackButtonState();
}

class _BuyCoinPackButtonState extends State<BuyCoinPackButton> {
  var _buying = false;

  Future<void> _buy() async {
    final purchaser = PurchaseScope.maybeOf(context)?.storePurchaser;
    if (_buying) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    void say(String text) =>
        messenger.showSnackBar(SnackBar(content: AutospacedText(text)));
    if (purchaser == null) {
      say(messages.purchaseStoreUnavailable);
      return;
    }
    final lock = widget.lock;
    if (lock != null && !lock.acquire()) {
      return;
    }
    setState(() {
      _buying = true;
    });
    try {
      final outcome = await purchaser.buyCoinPack(widget.pack.id);
      switch (outcome) {
        case StorePurchaseOutcome.purchased:
          say(messages.coinsPackPurchased(coinName: widget.coinName));
        case StorePurchaseOutcome.pending:
          say(messages.coinsPackConfirming(coinName: widget.coinName));
        case StorePurchaseOutcome.cancelled:
          return;
      }
      if (mounted) {
        widget.onChanged();
      }
    } on PurchaseFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        case PurchaseFailureKind.sessionExpired:
          unawaited(context.pushInTab(AppRoutes.signIn));
        case PurchaseFailureKind.network:
          say(messages.errorsRpcUnavailable);
        case PurchaseFailureKind.storeUnavailable:
          say(messages.purchaseStoreUnavailable);
        case PurchaseFailureKind.notSold || PurchaseFailureKind.gone:
          say(messages.coinsPacksUnavailable(coinName: widget.coinName));
          widget.onChanged();
        case PurchaseFailureKind.alreadyPurchased ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.unexpected:
          say(messages.purchaseStartFailed);
      }
    } finally {
      lock?.release();
      if (mounted) {
        setState(() {
          _buying = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final lock = widget.lock;
    if (lock == null) {
      return _button();
    }
    return ListenableBuilder(listenable: lock, builder: (_, _) => _button());
  }

  Widget _button() {
    final onPressed = _buying || (widget.lock?.held ?? false)
        ? null
        : () => unawaited(_buy());
    final label = AutospacedText(widget.label, textAlign: TextAlign.center);
    return widget.outlined
        ? OutlinedButton(onPressed: onPressed, child: label)
        : FilledButton(onPressed: onPressed, child: label);
  }
}
