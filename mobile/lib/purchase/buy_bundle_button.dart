import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Buys several episodes in one checkout — a volume, or the rest of a series —
/// through the web checkout handed to the system browser. Neither has a store
/// product, so a tenant that sells through the store offers neither.
///
/// A guest is sent to sign in first and comes back to the screen that sent
/// them, because a purchase is bought by an account. The return from the
/// browser is a link the app routes, not something this button waits for.
class BuyBundleButton extends StatefulWidget {
  const BuyBundleButton({
    super.key,
    required this.label,
    required this.start,
    required this.onRefused,
    this.onOpened,
  });

  /// What the button says, naming the price where the screen does not say it
  /// beside the button.
  final String label;

  /// Starts the checkout for the reader in [locale] and answers its page.
  final Future<Uri> Function(PurchaseRepository repository, String locale)
  start;

  /// The API answered that there is nothing to sell any more: the reader
  /// already holds it, or it is no longer sold. What the screen offers was
  /// read before that, so it reads it again.
  final VoidCallback onRefused;

  /// The browser took the checkout page, which is the reader starting a new
  /// purchase.
  final VoidCallback? onOpened;

  @override
  State<BuyBundleButton> createState() => _BuyBundleButtonState();
}

class _BuyBundleButtonState extends State<BuyBundleButton> {
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
    void report(String message) =>
        messenger.showSnackBar(SnackBar(content: AutospacedText(message)));
    setState(() {
      _starting = true;
    });
    try {
      final url = await widget.start(purchase.repository!, locale);
      if (!await purchase.launcher!.open(url)) {
        report(messages.purchaseStartFailed);
      } else if (mounted) {
        widget.onOpened?.call();
      }
    } on PurchaseFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        // The offer the reader tapped is out of date, and reading it again
        // says why: owned, or gone.
        case PurchaseFailureKind.alreadyPurchased:
          widget.onRefused();
        case PurchaseFailureKind.gone || PurchaseFailureKind.notSold:
          report(messages.purchaseStartFailed);
          widget.onRefused();
        case PurchaseFailureKind.sessionExpired:
          _signIn();
        case PurchaseFailureKind.network:
          report(messages.errorsRpcUnavailable);
        case PurchaseFailureKind.storeUnavailable ||
            PurchaseFailureKind.notSettled ||
            PurchaseFailureKind.unexpected:
          report(messages.purchaseStartFailed);
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
    unawaited(context.pushInTab(AppRoutes.signInPath()));
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: _starting ? null : () => unawaited(_buy()),
      child: AutospacedText(widget.label),
    );
  }
}
