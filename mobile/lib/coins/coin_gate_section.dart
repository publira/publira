import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/coins/buy_coin_pack_button.dart';
import 'package:publira/coins/coin_disclosures_view.dart';
import 'package:publira/coins/coin_failure.dart';
import 'package:publira/coins/coin_repository.dart';
import 'package:publira/coins/coin_shop.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/my_purchase.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What a locked episode's gate offers for the tenant's coins: the reader's
/// balance, a payment for each sale it covers, and, when it falls short of the
/// permanent copy, the smallest pack the store sells that makes up the
/// difference, with the pack's expiry and the tenant's disclosures beside it.
/// Where no pack is large enough, it sends the reader to every pack instead.
///
/// Every string names the coins in the tenant's own word for them. An offer
/// the reader can do nothing with — too few coins and no pack on sale — is
/// not shown at all.
class CoinGateSection extends StatefulWidget {
  const CoinGateSection({
    super.key,
    required this.offer,
    required this.episodeInternalId,
    required this.rentalPeriodHours,
    required this.onOpened,
    required this.onChanged,
  });

  final CoinGateOffer offer;
  final String episodeInternalId;

  /// How long a rental opens the episode, which the rental's button names.
  final int rentalPeriodHours;

  /// The payment went through, so the episode is the reader's.
  final VoidCallback onOpened;

  /// What the gate offers may have changed: a pack was bought, the price or
  /// the balance moved, or the reader is back from the packs.
  final VoidCallback onChanged;

  /// Whether [offer] gives the reader anything to do or to know.
  static bool shows(CoinGateOffer offer) => switch (offer) {
    CoinOfferFailed() => true,
    CoinOffer() =>
      offer.leads ||
          offer.pack != null ||
          (offer.needed > 0 && offer.packsOnSale),
  };

  @override
  State<CoinGateSection> createState() => _CoinGateSectionState();
}

class _CoinGateSectionState extends State<CoinGateSection> {
  var _paying = false;

  Future<void> _pay(CoinOffer offer, PurchaseKind kind) async {
    final coins = CoinScope.maybeOf(context);
    if (coins == null || _paying) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    void say(String text) =>
        messenger.showSnackBar(SnackBar(content: AutospacedText(text)));
    setState(() {
      _paying = true;
    });
    try {
      await coins.payEpisode(
        widget.episodeInternalId,
        coins: kind == PurchaseKind.rental ? offer.rentalPrice : offer.price,
        idempotencyKey: offer.idempotencyKey,
        locale: locale,
        kind: kind,
      );
      if (mounted) {
        widget.onOpened();
      }
    } on CoinFailure catch (failure) {
      if (!mounted) {
        return;
      }
      switch (failure.kind) {
        case CoinFailureKind.priceChanged:
          say(messages.coinsPriceChanged(coinName: offer.coinName));
          widget.onChanged();
        case CoinFailureKind.alreadyOpen:
          widget.onOpened();
        case CoinFailureKind.insufficient ||
            CoinFailureKind.unavailable ||
            CoinFailureKind.gone ||
            CoinFailureKind.notSold:
          widget.onChanged();
        case CoinFailureKind.sessionExpired:
          unawaited(context.pushInTab(AppRoutes.signIn));
        case CoinFailureKind.network:
          say(messages.errorsRpcUnavailable);
        case CoinFailureKind.tooManyRequests || CoinFailureKind.unexpected:
          say(messages.coinsPayFailed(coinName: offer.coinName));
      }
    } finally {
      if (mounted) {
        setState(() {
          _paying = false;
        });
      }
    }
  }

  Future<void> _openPacks() async {
    await context.pushInTab<void>(AppRoutes.coinsPath);
    if (mounted) {
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final theme = Theme.of(context);
    final offer = widget.offer;
    if (offer is! CoinOffer) {
      return AutospacedText(
        messages.coinsBalanceFailed,
        key: const ValueKey('episode-coins-failed'),
        textAlign: TextAlign.center,
        style: theme.textTheme.bodySmall,
      );
    }
    final coinName = offer.coinName;
    final pack = offer.pack;
    final onPay = _paying
        ? null
        : () => unawaited(_pay(offer, PurchaseKind.purchase));
    final onRent = _paying
        ? null
        : () => unawaited(_pay(offer, PurchaseKind.rental));
    final rentLabel = AutospacedText(
      messages.coinsGateRent(
        coinName: coinName,
        count: offer.rentalPrice,
        period: messages.purchaseRentalPeriod(hours: widget.rentalPeriodHours),
      ),
      textAlign: TextAlign.center,
    );
    return Column(
      key: const ValueKey('episode-coins'),
      mainAxisSize: MainAxisSize.min,
      children: [
        AutospacedText(
          offer.needed > 0
              ? messages.coinsGateShort(
                  balance: offer.balance,
                  coinName: coinName,
                  count: offer.needed,
                  price: offer.price,
                )
              : messages.coinsGateBalance(
                  coinName: coinName,
                  count: offer.balance,
                ),
          key: const ValueKey('episode-coins-balance'),
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 12,
          runSpacing: 12,
          children: [
            if (offer.coversPurchase)
              FilledButton(
                key: const ValueKey('episode-coins-pay'),
                onPressed: onPay,
                child: AutospacedText(
                  messages.coinsGatePay(coinName: coinName, count: offer.price),
                ),
              ),
            // The rental is the alternative to the permanent copy, so it
            // stands beside it in outline, and leads only on its own.
            if (offer.coversRental)
              offer.coversPurchase
                  ? OutlinedButton(
                      key: const ValueKey('episode-coins-rent'),
                      onPressed: onRent,
                      child: rentLabel,
                    )
                  : FilledButton(
                      key: const ValueKey('episode-coins-rent'),
                      onPressed: onRent,
                      child: rentLabel,
                    ),
            if (pack != null)
              BuyCoinPackButton(
                key: const ValueKey('episode-coins-pack'),
                pack: pack,
                coinName: coinName,
                label: messages.coinsGatePackBuy(
                  bonus: pack.bonusCoins,
                  coinName: coinName,
                  count: pack.totalCoins,
                  price: pack.price,
                ),
                outlined: offer.leads,
                onChanged: widget.onChanged,
              ),
            if (offer.needed > 0 && pack == null && offer.packsOnSale)
              OutlinedButton(
                key: const ValueKey('episode-coins-packs'),
                onPressed: () => unawaited(_openPacks()),
                child: AutospacedText(
                  messages.coinsGatePacks(coinName: coinName),
                ),
              ),
          ],
        ),
        if (pack != null) ...[
          const SizedBox(height: 12),
          if (offer.expiryDays > 0)
            AutospacedText(
              messages.coinsPackExpiry(
                coinName: coinName,
                days: offer.expiryDays,
              ),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          CoinDisclosuresView(
            disclosures: offer.disclosures,
            alignment: CrossAxisAlignment.center,
          ),
        ],
      ],
    );
  }
}
