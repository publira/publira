import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/published_label.dart';
import 'package:publira/models/series_item.dart';

/// A label: its artwork, and its published series, one cursor page at a time.
class LabelScreen extends StatefulWidget {
  const LabelScreen({super.key, required this.labelId});

  final String labelId;

  @override
  State<LabelScreen> createState() => _LabelScreenState();
}

class _LabelScreenState extends State<LabelScreen> {
  CatalogRepository? _catalog;
  CatalogPager<SeriesItem, PublishedLabel>? _pager;

  /// Reads the label again whenever the repository changes, for the reason
  /// the author screen does.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    Future<CatalogPageRead<SeriesItem, PublishedLabel>?> read(
      String token,
    ) async {
      final detail = await catalog.getLabelDetail(widget.labelId, token: token);
      if (detail == null) {
        return null;
      }
      return CatalogPageRead(
        items: detail.series.series,
        nextToken: detail.series.nextToken,
        header: detail.label,
      );
    }

    (_pager ??= CatalogPager(read)).restart(read);
  }

  @override
  void dispose() {
    _pager?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final pager = _pager!;
    return ListenableBuilder(
      listenable: pager,
      builder: (context, child) {
        final label = pager.header;
        return Scaffold(
          appBar: AppBar(title: Text(label?.name ?? messages.labelTitle)),
          body: _body(messages, pager, label),
        );
      },
    );
  }

  Widget _body(
    AppMessages messages,
    CatalogPager<SeriesItem, PublishedLabel> pager,
    PublishedLabel? label,
  ) {
    if (pager.notFound) {
      return CatalogMessage(
        key: const ValueKey('label-not-found'),
        message: messages.labelNotFound(id: widget.labelId),
        actionLabel: messages.commonBackToCatalog,
        onAction: () => context.goNamed('catalog'),
      );
    }
    final failure = pager.failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('label-error'),
        message: catalogFailureCopy(
          messages,
          failure,
          messages.labelLoadFailed,
        ),
        actionKey: const ValueKey('label-retry'),
        actionLabel: messages.commonRetry,
        onAction: pager.restart,
      );
    }
    if (label == null || pager.items == null) {
      return const Center(
        key: ValueKey('label-loading'),
        child: CircularProgressIndicator(),
      );
    }
    return CustomScrollView(
      key: const ValueKey('label-body'),
      slivers: [
        SliverToBoxAdapter(child: _LabelHeader(label: label)),
        PagedSeriesSliver(
          pager: pager,
          sectionKey: 'label-series',
          emptyMessage: messages.labelSeriesEmpty,
        ),
      ],
    );
  }
}

class _LabelHeader extends StatelessWidget {
  const _LabelHeader({required this.label});

  final PublishedLabel label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label.eyeCatchVariants.isNotEmpty) ...[
            // Capped for the reason the series banner is: a tablet's width
            // at 16:9 would push the series off the first screen.
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: EyeCatchCover(
                kind: 'label',
                id: label.id,
                variants: label.eyeCatchVariants,
                requestHeaders: label.imageRequestHeaders,
                preferredTypes: const [eyeCatchLandscape, eyeCatchSquare],
                aspectRatio: 16 / 9,
              ),
            ),
            const SizedBox(height: 16),
          ],
          Text(label.name, style: theme.textTheme.headlineSmall),
          if (label.seriesCount case final count?) ...[
            const SizedBox(height: 4),
            Text(
              messages.commonSeriesCount(count: messages.formatInteger(count)),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 24),
          Text(messages.labelSeriesHeading, style: theme.textTheme.titleMedium),
        ],
      ),
    );
  }
}
