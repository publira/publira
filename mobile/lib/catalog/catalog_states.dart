import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/l10n/gen/app_messages.dart';

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
    CatalogFailureKind.unexpected => fallback,
  };
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
  });

  final String message;

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
            Text(message, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(
                key: actionKey,
                onPressed: onAction,
                child: Text(actionLabel),
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
  });

  /// Names this section on screen, and the retry inside it.
  final String sectionKey;

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: ValueKey('$sectionKey-error'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 8),
          TextButton(
            key: ValueKey('$sectionKey-retry'),
            onPressed: onRetry,
            child: Text(AppMessages.of(context).commonRetry),
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
  });

  /// Names the list on screen: the spinner is `<sectionKey>-loading`, and the
  /// failure is a [RetryRow] of the same name.
  final String sectionKey;

  /// What went wrong reading the page, and `null` while it is still on its
  /// way.
  final String? message;

  final VoidCallback onRetry;

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
      ),
    );
  }
}
