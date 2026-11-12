import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/purchase/payment_lock.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The longest code a tenant can hold.
const _maxLength = 32;

/// What the server admits as a code. One spelled otherwise is refused without
/// asking, which would spend one of the reader's lookups to say the same.
final _spelling = RegExp(r'^[A-Za-z0-9]{1,32}$');

/// The most sales one `PreviewPromotionCode` call quotes. The server refuses a
/// longer list outright rather than quoting part of it.
const promotionCodeMaxSales = 100;

/// What the reader's code makes of the sales a screen offers. The screen that
/// owns the field holds it and hands each button its price and its code, so
/// the buttons keep taking what they name from their caller.
sealed class PromotionCodeState {
  const PromotionCodeState();

  /// The code as the reader entered it, empty when there is none.
  String get code => '';

  /// What [sale] costs with the code, `null` where it takes nothing off.
  PromotionCodeQuote? quoteOf(PromotionCodeSale sale) => null;

  /// The code [sale] is started with, empty where it takes nothing off.
  String codeFor(PromotionCodeSale sale) => quoteOf(sale) == null ? '' : code;
}

final class NoPromotionCode extends PromotionCodeState {
  const NoPromotionCode();
}

/// A code that takes something off at least one of the sales. A sale it takes
/// nothing off keeps its price, and is not in [quotes].
final class AppliedPromotionCode extends PromotionCodeState {
  const AppliedPromotionCode({required this.code, required this.quotes});

  @override
  final String code;

  final Map<PromotionCodeSale, PromotionCodeQuote> quotes;

  @override
  PromotionCodeQuote? quoteOf(PromotionCodeSale sale) => quotes[sale];
}

/// A code that takes nothing off any of the sales, for the `reason` the field
/// words under itself.
final class RefusedPromotionCode extends PromotionCodeState {
  const RefusedPromotionCode({required this.code, required this.reason});

  @override
  final String code;

  final PurchaseFailureKind reason;
}

/// What [rawCode] makes of [sales], quoted in one call for one lookup.
///
/// A code the store has no product for names that as its refusal rather than
/// not applying, since it works on the website.
///
/// Throws [PurchaseFailure] for an expired session alone, for the caller to
/// send the reader to sign in.
Future<PromotionCodeState> quotePromotionCode(
  PurchaseRepository repository,
  String rawCode,
  List<PromotionCodeSale> sales, {
  required bool store,
}) async {
  final code = rawCode.trim();
  if (code.isEmpty || sales.isEmpty) {
    return const NoPromotionCode();
  }
  if (!_spelling.hasMatch(code)) {
    return RefusedPromotionCode(
      code: code,
      reason: PurchaseFailureKind.promotionCodeInvalid,
    );
  }
  final List<PromotionCodeQuote> quotes;
  try {
    quotes = await repository.previewPromotionCode(code, sales, store: store);
  } on PurchaseFailure catch (failure) {
    if (failure.kind == PurchaseFailureKind.sessionExpired) {
      rethrow;
    }
    return RefusedPromotionCode(code: code, reason: failure.kind);
  }
  // One quote per sale, in the order they were asked for.
  final applied = {
    for (final (index, sale) in sales.indexed)
      if (index < quotes.length && quotes[index].refusal == null)
        sale: quotes[index],
  };
  if (applied.isNotEmpty) {
    return AppliedPromotionCode(code: code, quotes: applied);
  }
  final notInApp = quotes.any(
    (quote) => quote.refusal == PromotionCodeSaleRefusal.noStoreProduct,
  );
  return RefusedPromotionCode(
    code: code,
    reason: notInApp
        ? PurchaseFailureKind.promotionCodeNotInApp
        : PurchaseFailureKind.promotionCodeNotApplicable,
  );
}

/// The **Promotion code** field and its **Apply**, which quotes what the
/// reader typed against [sales] and hands the answer to [onChanged].
///
/// Emptying the field and applying takes the code off. What the code does to
/// a price is shown on the buttons the screen builds from [state], and the
/// field says only whether it was applied, or why it was not.
class PromotionCodeField extends StatefulWidget {
  const PromotionCodeField({
    super.key,
    required this.sales,
    required this.store,
    required this.state,
    required this.onChanged,
    this.lock,
  });

  /// The sales the screen offers, at most [promotionCodeMaxSales] of them,
  /// either an episode's or volumes.
  final List<PromotionCodeSale> sales;

  /// Whether [sales] are purchases through the app's store.
  final bool store;

  final PromotionCodeState state;

  final ValueChanged<PromotionCodeState> onChanged;

  /// Shared with the screen's ways to pay, so nothing is bought at the old
  /// price while a code is being quoted.
  final PaymentLock? lock;

  @override
  State<PromotionCodeField> createState() => _PromotionCodeFieldState();
}

class _PromotionCodeFieldState extends State<PromotionCodeField> {
  late final _controller = TextEditingController(text: widget.state.code);
  var _applying = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final repository = PurchaseScope.maybeOf(context)?.repository;
    final lock = widget.lock;
    if (repository == null || _applying || (lock != null && !lock.acquire())) {
      return;
    }
    setState(() {
      _applying = true;
    });
    try {
      final state = await quotePromotionCode(
        repository,
        _controller.text,
        widget.sales,
        store: widget.store,
      );
      if (mounted) {
        widget.onChanged(state);
      }
    } on PurchaseFailure {
      if (mounted) {
        unawaited(context.pushInTab(AppRoutes.signInPath()));
      }
    } finally {
      lock?.release();
      if (mounted) {
        setState(() {
          _applying = false;
        });
      }
    }
  }

  String _refusal(AppMessages messages, PurchaseFailureKind reason) {
    return switch (reason) {
      PurchaseFailureKind.promotionCodeInvalid =>
        messages.purchasePromotionCodeInvalid,
      PurchaseFailureKind.promotionCodeExpired =>
        messages.purchasePromotionCodeExpired,
      PurchaseFailureKind.promotionCodeExhausted =>
        messages.purchasePromotionCodeExhausted,
      PurchaseFailureKind.promotionCodeAlreadyRedeemed =>
        messages.purchasePromotionCodeAlreadyRedeemed,
      PurchaseFailureKind.promotionCodeNotApplicable =>
        widget.sales.any((sale) => sale.volumeInternalId != null)
            ? messages.purchasePromotionCodeNotApplicableVolumes
            : messages.purchasePromotionCodeNotApplicableEpisode,
      PurchaseFailureKind.promotionCodeNotInApp =>
        messages.purchasePromotionCodeNotInApp,
      PurchaseFailureKind.promotionCodeRateLimited =>
        messages.purchasePromotionCodeRateLimited,
      _ => messages.purchasePromotionCodeError,
    };
  }

  @override
  Widget build(BuildContext context) {
    final lock = widget.lock;
    if (lock == null) {
      return _field(context);
    }
    return ListenableBuilder(
      listenable: lock,
      builder: (context, _) => _field(context),
    );
  }

  Widget _field(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final state = widget.state;
    final (message, color) = switch (state) {
      NoPromotionCode() => (null, null),
      AppliedPromotionCode(:final code) => (
        messages.purchasePromotionCodeApplied(code: code),
        theme.colorScheme.onSurfaceVariant,
      ),
      RefusedPromotionCode(:final reason) => (
        _refusal(messages, reason),
        theme.colorScheme.error,
      ),
    };
    final busy = _applying || (widget.lock?.held ?? false);
    // A row of a text field and a button needs a width to divide, which a
    // gate's actions leave open.
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 360),
      child: Column(
        key: const ValueKey('promotion-code-field'),
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('promotion-code-input'),
                  controller: _controller,
                  autocorrect: false,
                  enableSuggestions: false,
                  inputFormatters: [
                    LengthLimitingTextInputFormatter(_maxLength),
                  ],
                  decoration: InputDecoration(
                    label: AutospacedText(messages.purchasePromotionCode),
                    isDense: true,
                  ),
                  textInputAction: TextInputAction.done,
                  onSubmitted: busy ? null : (_) => unawaited(_apply()),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                key: const ValueKey('promotion-code-apply'),
                onPressed: busy ? null : () => unawaited(_apply()),
                child: AutospacedText(messages.purchasePromotionCodeApply),
              ),
            ],
          ),
          if (message != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              // Said as it arrives: the reader's eyes are on the keyboard.
              child: Semantics(
                liveRegion: true,
                child: AutospacedText(
                  key: const ValueKey('promotion-code-message'),
                  message,
                  style: theme.textTheme.bodySmall?.copyWith(color: color),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The price a code was taken off, struck through beside what it leaves.
///
/// Strike-through is not announced by a screen reader, so it carries its name
/// in words for one, as a campaign's regular price does.
class PriceBeforePromotionCode extends StatelessWidget {
  const PriceBeforePromotionCode({super.key, required this.price});

  /// Formatted for the reader.
  final String price;

  @override
  Widget build(BuildContext context) {
    return AutospacedText(
      price,
      semanticsLabel: AppMessages.of(
        context,
      ).purchasePromotionCodeListPrice(price: price),
      style: const TextStyle(decoration: TextDecoration.lineThrough),
    );
  }
}

/// What a button says once a code applies to its sale: [label], at the
/// discounted price, and beside it [listPrice], struck through.
class DiscountedButtonLabel extends StatelessWidget {
  const DiscountedButtonLabel({
    super.key,
    required this.label,
    required this.listPrice,
  });

  final String label;

  /// Formatted for the reader.
  final String listPrice;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      children: [
        AutospacedText(label, textAlign: TextAlign.center),
        PriceBeforePromotionCode(price: listPrice),
      ],
    );
  }
}
