import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/purchase/store_subscriber.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Opens the sheet listing [plans] as [subscriber]'s store sells them, and
/// answers how it was closed: the [StoreSubscriptionOutcome] of a plan the
/// reader subscribed to, the [PurchaseFailure] that stopped one, or `null`
/// for a sheet the reader dismissed.
Future<Object?> showSubscriptionPlansSheet(
  BuildContext context, {
  required List<SubscriptionPlan> plans,
  required StoreSubscriber subscriber,
}) => showModalBottomSheet<Object>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) =>
      SubscriptionPlansSheet(plans: plans, subscriber: subscriber),
);

/// The plans that open a locked episode, each with the price and the period
/// the device's store bills, what it opens, and **Subscribe**, which opens
/// the store's payment sheet for it. A plan whose product the store does not
/// sell is left out.
///
/// A subscription the store took, settled or not, closes the sheet with its
/// outcome, and so does a failure, which the screen behind reports. A payment
/// sheet the reader closed leaves this one open, as a purchase leaves the
/// gate: nothing was charged.
class SubscriptionPlansSheet extends StatefulWidget {
  const SubscriptionPlansSheet({
    super.key,
    required this.plans,
    required this.subscriber,
  });

  final List<SubscriptionPlan> plans;
  final StoreSubscriber subscriber;

  @override
  State<SubscriptionPlansSheet> createState() => _SubscriptionPlansSheetState();
}

class _SubscriptionPlansSheetState extends State<SubscriptionPlansSheet> {
  late final Future<List<StorePlanOffer>> _offers = widget.subscriber.offers(
    widget.plans,
  );

  /// The plan whose payment sheet is open, or `null`.
  String? _subscribing;

  Future<void> _subscribe(SubscriptionPlan plan) async {
    if (_subscribing != null) {
      return;
    }
    setState(() {
      _subscribing = plan.id;
    });
    final navigator = Navigator.of(context);
    try {
      final outcome = await widget.subscriber.subscribe(plan.id);
      if (mounted && outcome != StoreSubscriptionOutcome.cancelled) {
        navigator.pop(outcome);
      }
    } on PurchaseFailure catch (failure) {
      if (mounted) {
        navigator.pop(failure);
      }
    } finally {
      if (mounted) {
        setState(() {
          _subscribing = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final textTheme = Theme.of(context).textTheme;
    return FutureBuilder<List<StorePlanOffer>>(
      future: _offers,
      builder: (context, snapshot) {
        final Widget body;
        if (snapshot.connectionState != ConnectionState.done) {
          body = const Padding(
            padding: EdgeInsets.all(24),
            child: Center(
              key: ValueKey('subscription-plans-loading'),
              child: CircularProgressIndicator(),
            ),
          );
        } else if (snapshot.data case final offers? when offers.isNotEmpty) {
          body = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final offer in offers) _offer(messages, offer)],
          );
        } else {
          body = Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: AutospacedText(
              messages.purchasePlansEmpty,
              key: const ValueKey('subscription-plans-empty'),
            ),
          );
        }
        return SingleChildScrollView(
          key: const ValueKey('subscription-plans'),
          padding: const EdgeInsets.only(bottom: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                child: AutospacedText(
                  messages.purchasePlansTitle,
                  style: textTheme.titleLarge,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: AutospacedText(messages.purchasePlansDescription),
              ),
              body,
            ],
          ),
        );
      },
    );
  }

  Widget _offer(AppMessages messages, StorePlanOffer offer) {
    final plan = offer.plan;
    final textTheme = Theme.of(context).textTheme;
    final covers = _covers(messages, plan);
    final subscribing = _subscribing;
    return Padding(
      key: ValueKey('subscription-plan-${plan.id}'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AutospacedText(plan.name, style: textTheme.titleMedium),
          AutospacedText(
            _billing(messages, offer),
            key: ValueKey('subscription-plan-price-${plan.id}'),
            style: textTheme.bodyLarge,
          ),
          if (plan.description.isNotEmpty) AutospacedText(plan.description),
          if (covers != null) AutospacedText(covers),
          const SizedBox(height: 8),
          FilledButton(
            key: ValueKey('subscription-plan-subscribe-${plan.id}'),
            onPressed: subscribing == null
                ? () => unawaited(_subscribe(plan))
                : null,
            child: AutospacedText(messages.purchaseSubscribe),
          ),
        ],
      ),
    );
  }

  /// The store's price over the store's period, or the price alone where the
  /// store did not say how often it bills.
  static String _billing(AppMessages messages, StorePlanOffer offer) {
    final period = offer.period;
    if (period == null) {
      return offer.price;
    }
    final price = offer.price;
    final count = period.count;
    return switch (period.unit) {
      StoreBillingUnit.day => messages.purchasePlanBillingDay(
        count: count,
        price: price,
      ),
      StoreBillingUnit.week => messages.purchasePlanBillingWeek(
        count: count,
        price: price,
      ),
      StoreBillingUnit.month => messages.purchasePlanBillingMonth(
        count: count,
        price: price,
      ),
      StoreBillingUnit.year => messages.purchasePlanBillingYear(
        count: count,
        price: price,
      ),
    };
  }

  /// What [plan] opens, or `null` for a plan of labels or series none of
  /// which the app may show.
  static String? _covers(AppMessages messages, SubscriptionPlan plan) {
    return switch (plan.scope) {
      SubscriptionPlanScope.all => messages.purchasePlanScopeAll,
      SubscriptionPlanScope.label =>
        plan.labelNames.isEmpty
            ? null
            : messages.purchasePlanScopeLabels(
                labels: messages.formatList(plan.labelNames),
              ),
      SubscriptionPlanScope.series =>
        plan.seriesTitles.isEmpty
            ? null
            : messages.purchasePlanScopeSeries(
                series: messages.formatList(plan.seriesTitles),
              ),
    };
  }
}
