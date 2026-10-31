import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What a section says about a failure, in the words closest to it.
///
/// A request that could not reach the API and a device holding nothing saved
/// are the same two answers wherever they happen, so only the rest is left to
/// the section: [fallback] is what it calls a failure of its own.
String catalogFailureCopy(
  AppMessages messages,
  Object? error,
  String fallback,
) {
  if (error is! CatalogFailure) {
    return fallback;
  }
  return switch (error.kind) {
    CatalogFailureKind.network => messages.errorsRpcUnavailable,
    CatalogFailureKind.notSaved ||
    CatalogFailureKind.saveExpired => messages.catalogOfflineNotSaved,
    CatalogFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
    CatalogFailureKind.rateLimited => messages.errorsRpcRateLimited,
    CatalogFailureKind.unexpected => fallback,
  };
}

/// How long a retry of [error] is held back: the wait a rate limit asked for,
/// and `null` for any other failure.
Duration? catalogRetryAfter(Object? error) =>
    error is CatalogFailure && error.kind == CatalogFailureKind.rateLimited
    ? error.retryAfter
    : null;

/// Holds a retry back while the wait a rate limit asked for runs, so a press
/// before it has passed is not refused again, spending the allowance the
/// reader is waiting on.
///
/// The wait counts from when the refusal is first on screen, which is never
/// earlier than when it arrived. Key it by the failure it answers, so a new
/// refusal starts a wait of its own.
class RetryHold extends StatefulWidget {
  const RetryHold({super.key, required this.wait, required this.builder});

  /// `null`, or no time at all, holds nothing back.
  final Duration? wait;

  /// Builds the retry, which is to be disabled while `held`.
  final Widget Function(BuildContext context, bool held) builder;

  @override
  State<RetryHold> createState() => _RetryHoldState();
}

class _RetryHoldState extends State<RetryHold> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    final wait = widget.wait;
    if (wait != null && wait > Duration.zero) {
      _timer = Timer(wait, () => setState(() {}));
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      widget.builder(context, _timer?.isActive ?? false);
}

/// What a screen shows where its rows would be: one line, centred, with the
/// offer to ask again where there is one.
class CatalogMessage extends StatelessWidget {
  const CatalogMessage({
    super.key,
    required this.message,
    this.actionKey,
    this.actionLabel,
    this.onAction,
    this.failure,
  });

  final String message;

  /// The failure [message] reports, whose rate limit holds [onAction] back.
  final Object? failure;

  /// Names the button on screen, so a test reaches the retry of the screen it
  /// is about rather than any retry.
  final ValueKey<String>? actionKey;

  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final actionLabel = this.actionLabel;
    final onAction = this.onAction;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AutospacedText(message, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              RetryHold(
                key: ObjectKey(failure),
                wait: catalogRetryAfter(failure),
                builder: (context, held) => FilledButton(
                  key: actionKey,
                  onPressed: held ? null : onAction,
                  child: AutospacedText(actionLabel),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// What a section shows in place of its contents when the API could not
/// answer it: what went wrong, and the offer to ask again.
class RetryRow extends StatelessWidget {
  const RetryRow({
    super.key,
    required this.sectionKey,
    required this.message,
    required this.onRetry,
    this.failure,
  });

  /// Names this section on screen, and the retry inside it.
  final String sectionKey;

  final String message;
  final VoidCallback onRetry;

  /// The failure [message] reports, whose rate limit holds [onRetry] back.
  final Object? failure;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: ValueKey('$sectionKey-error'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          AutospacedText(message),
          const SizedBox(height: 8),
          RetryHold(
            key: ObjectKey(failure),
            wait: catalogRetryAfter(failure),
            builder: (context, held) => TextButton(
              key: ValueKey('$sectionKey-retry'),
              onPressed: held ? null : onRetry,
              child: AutospacedText(AppMessages.of(context).commonRetry),
            ),
          ),
        ],
      ),
    );
  }
}

/// The page under a paged list, at the bottom of it: a spinner while that page
/// is being read, and what went wrong when it could not be.
class PageFooter extends StatelessWidget {
  const PageFooter({
    super.key,
    required this.sectionKey,
    required this.message,
    required this.onRetry,
    this.failure,
  });

  /// Names the list on screen: the spinner is `<sectionKey>-loading`, and the
  /// failure is a [RetryRow] of the same name.
  final String sectionKey;

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

  /// The failure [message] reports, whose rate limit holds [onRetry] back.
  final Object? failure;

  @override
  Widget build(BuildContext context) {
    final message = this.message;
    if (message == null) {
      return Padding(
        key: ValueKey('$sectionKey-loading'),
        padding: const EdgeInsets.all(16),
        child: const Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: RetryRow(
        sectionKey: sectionKey,
        message: message,
        onRetry: onRetry,
        failure: failure,
      ),
    );
  }
}
