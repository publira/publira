import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';

/// A cursor-paged list that is the whole of what stands under an app bar:
/// every row [pager] has read, and the page under them asked for as the reader
/// nears the end.
///
/// It owns every state of the list, the first page's loading and failure
/// included, so a screen gives it the pager and the words for its states.
///
/// Every row is a way into part of the catalog that stands on its own, so a
/// tablet's window lays them out in columns.
class PagedList<T> extends StatelessWidget {
  const PagedList({
    super.key,
    required this.pager,
    required this.sectionKey,
    required this.emptyMessage,
    required this.failedMessage,
    required this.itemBuilder,
    this.onRetryMore,
  });

  final CatalogPager<T, Object?> pager;

  /// Names the list on screen: `<sectionKey>-loading`, `-error`, `-retry`,
  /// `-empty`, and `-results`, and the footer as `<sectionKey>-more`.
  final String sectionKey;

  final String emptyMessage;

  /// What the list calls a failure of its own.
  final String failedMessage;

  final Widget Function(T item) itemBuilder;

  /// What the footer's retry does once a later page has failed. Asks for that
  /// page again when `null`.
  final VoidCallback? onRetryMore;

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
        final columns = columnCount(context);
        final rows = rowCount(items.length, columns);
        return ListView.separated(
          key: ValueKey('$sectionKey-results'),
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: rows + (hasFooter ? 1 : 0),
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index >= rows - readAheadRows) {
              pager.readMore();
            }
            if (index == rows) {
              return PageFooter(
                sectionKey: '$sectionKey-more',
                message: pager.moreFailure == null
                    ? null
                    : catalogFailureCopy(
                        messages,
                        pager.moreFailure,
                        failedMessage,
                      ),
                onRetry: onRetryMore ?? pager.retryMore,
              );
            }
            return ColumnRow(
              row: index,
              columns: columns,
              itemCount: items.length,
              itemBuilder: (context, index) => itemBuilder(items[index]),
            );
          },
        );
      },
    );
  }
}
