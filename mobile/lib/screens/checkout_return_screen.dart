import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/purchase/purchase_failure.dart';
import 'package:publira/purchase/purchase_repository.dart';
import 'package:publira/router.dart';

/// Where a checkout the browser hands back lands: it finds the series of the
/// episode the return URL names and opens that episode's viewer, which is what
/// confirms the purchase.
class CheckoutReturnScreen extends StatefulWidget {
  const CheckoutReturnScreen({
    super.key,
    required this.episodeId,
    required this.outcome,
  });

  final String episodeId;

  /// `null` for a status the API does not send, which opens the episode as it
  /// stands.
  final CheckoutOutcome? outcome;

  @override
  State<CheckoutReturnScreen> createState() => _CheckoutReturnScreenState();
}

class _CheckoutReturnScreenState extends State<CheckoutReturnScreen> {
  var _started = false;
  Future<String?>? _series;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _resolve();
  }

  /// A second return link differs only in its query, which go_router answers
  /// with this same state, so the new episode is looked up in place of the old.
  @override
  void didUpdateWidget(CheckoutReturnScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.episodeId != oldWidget.episodeId ||
        widget.outcome != oldWidget.outcome) {
      _resolve();
    }
  }

  void _resolve() {
    final repository = PurchaseScope.maybeOf(context)?.repository;
    if (repository == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          context.go(AppRoutes.catalog);
        }
      });
      return;
    }
    final series = repository.seriesOfEpisode(widget.episodeId);
    setState(() {
      _series = series;
    });
    unawaited(_open(series));
  }

  Future<void> _open(Future<String?> series) async {
    final String? seriesId;
    try {
      seriesId = await series;
    } on PurchaseFailure {
      // The FutureBuilder shows the failure and offers the retry.
      return;
    }
    if (!mounted || seriesId == null || series != _series) {
      return;
    }
    // In place of this screen, with the series behind the viewer the way any
    // other link to an episode opens.
    context.go(
      AppRoutes.episodeViewerPath(
        seriesId,
        widget.episodeId,
        checkout: widget.outcome,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.viewerTitle)),
      body: FutureBuilder<String?>(
        future: _series,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done ||
              snapshot.data != null) {
            return const Center(
              key: ValueKey('checkout-return-loading'),
              child: CircularProgressIndicator(),
            );
          }
          final error = snapshot.error;
          if (error == null) {
            return _ReturnMessage(
              message: messages.viewerNotFound(id: widget.episodeId),
              actionLabel: messages.commonBackToCatalog,
              onAction: () => context.go(AppRoutes.catalog),
            );
          }
          return _ReturnMessage(
            message:
                error is PurchaseFailure &&
                    error.kind == PurchaseFailureKind.network
                ? messages.errorsRpcUnavailable
                : messages.viewerLoadFailed,
            actionLabel: messages.commonRetry,
            onAction: _resolve,
          );
        },
      ),
    );
  }
}

class _ReturnMessage extends StatelessWidget {
  const _ReturnMessage({
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      key: const ValueKey('checkout-return-error'),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onAction, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
