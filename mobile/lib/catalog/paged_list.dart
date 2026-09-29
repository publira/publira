import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// A cursor-paged list that is the whole of what stands under an app bar:
/// every row [pager] has read, and the page under them asked for as the reader
/// nears the end.
///
/// It owns every state of the list, the first page's loading and failure
/// included, so a screen gives it the pager and the words for its states.
class PagedList<T> extends StatelessWidget {
  const PagedList({
    super.key,
    required this.pager,
    required this.sectionKey,
    required this.emptyMessage,
    required this.failedMessage,
    required this.itemBuilder,
  });

  final CatalogPager<T, Object?> pager;

  /// Names the list on screen: `<sectionKey>-loading`, `-error`, `-retry`,
  /// `-empty`, and `-results`, and the footer as `<sectionKey>-more`.
  final String sectionKey;

  final String emptyMessage;

  /// What the list calls a failure of its own.
  final String failedMessage;

  final Widget Function(T item) itemBuilder;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final failure = pager.failure;
        if (failure != null) {
          return CatalogMessage(
            key: ValueKey('$sectionKey-error'),
            message: catalogFailureCopy(messages, failure, failedMessage),
            actionKey: ValueKey('$sectionKey-retry'),
            actionLabel: messages.commonRetry,
            onAction: pager.restart,
          );
        }
        final items = pager.items;
        if (items == null) {
          return Padding(
            key: ValueKey('$sectionKey-loading'),
            padding: const EdgeInsets.all(24),
            child: const Center(child: CircularProgressIndicator()),
          );
        }
        final hasFooter = pager.hasFooter;
        if (items.isEmpty && !hasFooter) {
          return CatalogMessage(
            key: ValueKey('$sectionKey-empty'),
            message: emptyMessage,
          );
        }
        return ListView.separated(
          key: ValueKey('$sectionKey-results'),
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: items.length + (hasFooter ? 1 : 0),
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= items.length - readAheadRows) {
              pager.readMore();
            }
            if (index == items.length) {
              return PageFooter(
                sectionKey: '$sectionKey-more',
                message: pager.moreFailure == null
                    ? null
                    : catalogFailureCopy(
                        messages,
                        pager.moreFailure,
                        failedMessage,
                      ),
                onRetry: pager.retryMore,
              );
            }
            return itemBuilder(items[index]);
          },
        );
      },
    );
  }
}
