import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/catalog/catalog_pager.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/creator_tile.dart';
import 'package:publira/catalog/paged_series_sliver.dart';
import 'package:publira/follow/follow_control.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/models/published_creator.dart';
import 'package:publira/models/series_item.dart';

/// An author: who they are, and the published series credited to them, one
/// cursor page at a time.
class CreatorScreen extends StatefulWidget {
  const CreatorScreen({super.key, required this.creatorId});

  final String creatorId;

  @override
  State<CreatorScreen> createState() => _CreatorScreenState();
}

class _CreatorScreenState extends State<CreatorScreen> {
  CatalogRepository? _catalog;
  CatalogPager<SeriesItem, PublishedCreator>? _pager;

  /// Reads the author again whenever the repository changes, the way the
  /// search screen does: rows and a token answered by the repository just
  /// replaced would page out of another.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    Future<CatalogPageRead<SeriesItem, PublishedCreator>?> read(
      String token,
    ) async {
      final detail = await catalog.getCreatorDetail(
        widget.creatorId,
        token: token,
      );
      if (detail == null) {
        return null;
      }
      return CatalogPageRead(
        items: detail.series.series,
        nextToken: detail.series.nextToken,
        header: detail.creator,
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
        final creator = pager.header;
        return Scaffold(
          appBar: AppBar(title: Text(creator?.name ?? messages.creatorTitle)),
          body: _body(messages, pager, creator),
        );
      },
    );
  }

  Widget _body(
    AppMessages messages,
    CatalogPager<SeriesItem, PublishedCreator> pager,
    PublishedCreator? creator,
  ) {
    if (pager.notFound) {
      return CatalogMessage(
        key: const ValueKey('creator-not-found'),
        message: messages.creatorNotFound(id: widget.creatorId),
        actionLabel: messages.commonBackToCatalog,
        onAction: () => context.goNamed('catalog'),
      );
    }
    final failure = pager.failure;
    if (failure != null) {
      return CatalogMessage(
        key: const ValueKey('creator-error'),
        message: catalogFailureCopy(
          messages,
          failure,
          messages.creatorLoadFailed,
        ),
        actionKey: const ValueKey('creator-retry'),
        actionLabel: messages.commonRetry,
        onAction: pager.restart,
      );
    }
    if (creator == null || pager.items == null) {
      return const Center(
        key: ValueKey('creator-loading'),
        child: CircularProgressIndicator(),
      );
    }
    return CustomScrollView(
      key: const ValueKey('creator-body'),
      slivers: [
        SliverToBoxAdapter(child: _CreatorHeader(creator: creator)),
        PagedSeriesSliver(
          pager: pager,
          sectionKey: 'creator-series',
          emptyMessage: messages.creatorSeriesEmpty,
        ),
      ],
    );
  }
}

class _CreatorHeader extends StatelessWidget {
  const _CreatorHeader({required this.creator});

  final PublishedCreator creator;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final muted = TextStyle(color: theme.colorScheme.onSurfaceVariant);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CreatorPortrait(creator: creator, radius: 40),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(creator.name, style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 4),
                    Text(
                      messages.commonSeriesCount(
                        count: messages.formatInteger(creator.seriesCount),
                      ),
                      style: theme.textTheme.bodyMedium?.merge(muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (creator.profileText.isEmpty)
            Text(
              key: const ValueKey('creator-profile-empty'),
              messages.creatorProfileEmpty,
              style: theme.textTheme.bodyMedium?.merge(muted),
            )
          else
            Text(
              key: const ValueKey('creator-profile'),
              creator.profileText,
              style: theme.textTheme.bodyLarge,
            ),
          if (FollowScope.maybeOf(context) != null) ...[
            const SizedBox(height: 16),
            FollowControl(
              kind: FollowTargetKind.creator,
              targetId: creator.id,
              targetName: creator.name,
            ),
          ],
          const SizedBox(height: 24),
          Text(
            messages.creatorSeriesHeading,
            style: theme.textTheme.titleMedium,
          ),
        ],
      ),
    );
  }
}
