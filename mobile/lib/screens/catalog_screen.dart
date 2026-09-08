import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/series_cover.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

/// Home / catalog list. Loads published series from [CatalogRepository].
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  late Future<List<SeriesItem>> _future;
  var _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _future = CatalogScope.of(context).listSeries();
  }

  void _reload() {
    setState(() {
      _future = CatalogScope.of(context).listSeries();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Publira'),
        actions: [
          IconButton(
            key: const ValueKey('catalog-account'),
            icon: Icon(signedIn ? Icons.person : Icons.person_outline),
            tooltip: signedIn ? messages.accountTitle : messages.commonSignIn,
            onPressed: () =>
                context.push(signedIn ? AppRoutes.account : AppRoutes.signIn),
          ),
        ],
      ),
      body: FutureBuilder<List<SeriesItem>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              key: ValueKey('catalog-loading'),
              child: CircularProgressIndicator(),
            );
          }
          if (snapshot.hasError) {
            return _CatalogMessage(
              key: const ValueKey('catalog-error'),
              message: _errorCopy(messages, snapshot.error),
              actionLabel: messages.commonRetry,
              onAction: _reload,
            );
          }
          final series = snapshot.data ?? const <SeriesItem>[];
          if (series.isEmpty) {
            return _CatalogMessage(
              key: const ValueKey('catalog-empty'),
              message: messages.catalogEmpty,
            );
          }
          return CustomScrollView(
            slivers: [
              const SliverToBoxAdapter(child: _ContinueReading()),
              SliverPadding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                sliver: SliverList.separated(
                  itemCount: series.length,
                  separatorBuilder: (context, index) =>
                      const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final item = series[index];
                    return ListTile(
                      key: ValueKey('series-tile-${item.id}'),
                      // 42 is the widest a 3:4 box can be and still stand inside
                      // the 56 pixels ListTile allows its leading widget; a
                      // taller one is squeezed back to this width anyway.
                      leading: SizedBox(
                        width: 42,
                        child: SeriesCover(
                          series: item,
                          preferredTypes: const [eyeCatchPortrait],
                          aspectRatio: 3 / 4,
                        ),
                      ),
                      title: Text(item.title),
                      subtitle: item.description.isEmpty
                          ? null
                          : Text(
                              item.description,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                      trailing: item.labelName.isEmpty
                          ? null
                          : Text(item.labelName),
                      onTap: () {
                        context.push(AppRoutes.seriesDetailPath(item.id));
                      },
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _errorCopy(AppMessages messages, Object? error) {
    if (error is! CatalogFailure) {
      return messages.catalogLoadFailed;
    }
    return switch (error.kind) {
      CatalogFailureKind.network => messages.errorsRpcUnavailable,
      CatalogFailureKind.notSaved ||
      CatalogFailureKind.saveExpired => messages.catalogOfflineNotSaved,
      CatalogFailureKind.unexpected => messages.catalogLoadFailed,
    };
  }
}

/// How many offers the row asks for. A phone shows two and a half of them at
/// once, so ten is several flicks of scrolling and one page of the API's list.
const _continueReadingLimit = 10;

/// Width of one offer, and the shape its cover is cut to.
const _continueReadingCardWidth = 132.0;
const _continueReadingCardAspectRatio = 3 / 4;

/// The reader's own continue-reading row, above the catalog.
///
/// A reader who is signed out, in the middle of nothing, or on a device that
/// could not reach the API sees the catalog they have always seen: the row is
/// an offer, and the screen behind it is the answer to a failure rather than
/// this row reporting one.
class _ContinueReading extends StatefulWidget {
  const _ContinueReading();

  @override
  State<_ContinueReading> createState() => _ContinueReadingState();
}

class _ContinueReadingState extends State<_ContinueReading> {
  var _items = const <RecentSeriesItem>[];
  var _readerId = '';
  var _started = false;

  /// The row is one reader's own history, so a sign-in or a sign-out asks
  /// again rather than showing what the reader before them was reading.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    if (_started && readerId == _readerId) {
      return;
    }
    _started = true;
    _readerId = readerId;
    _items = const [];
    unawaited(_load(CatalogScope.of(context), readerId));
  }

  Future<void> _load(CatalogRepository catalog, String readerId) async {
    // The row is a member's own history. Nobody is signed in, so there is
    // nothing to ask for.
    if (readerId.isEmpty) {
      return;
    }
    List<RecentSeriesItem> items;
    try {
      items = await catalog.listRecentSeries(limit: _continueReadingLimit);
    } on CatalogFailure {
      items = const [];
    }
    // The reader may have signed in or out while the API was answering, in
    // which case this answer is about somebody else.
    if (!mounted || readerId != _readerId) {
      return;
    }
    setState(() {
      _items = items;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return Column(
      key: const ValueKey('continue-reading'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            messages.catalogContinueHeading,
            style: theme.textTheme.titleMedium,
          ),
        ),
        SizedBox(
          // The cover plus the two lines under it, which is what the card is
          // allowed to grow to before its text starts to ellipsize.
          height:
              _continueReadingCardWidth / _continueReadingCardAspectRatio + 80,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: _items.length,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (context, index) =>
                _ContinueReadingCard(item: _items[index]),
          ),
        ),
      ],
    );
  }
}

/// One offer: the cover of the series, its title, and the episode to open.
class _ContinueReadingCard extends StatelessWidget {
  const _ContinueReadingCard({required this.item});

  final RecentSeriesItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: _continueReadingCardWidth,
      child: InkWell(
        key: ValueKey('continue-reading-${item.series.id}'),
        onTap: () => context.push(
          AppRoutes.episodeViewerPath(item.series.id, item.episode.id),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SeriesCover(
              series: item.series,
              preferredTypes: const [eyeCatchPortrait],
              aspectRatio: _continueReadingCardAspectRatio,
            ),
            const SizedBox(height: 8),
            Flexible(
              child: Text(
                item.series.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            Flexible(
              child: Text(
                item.episode.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogMessage extends StatelessWidget {
  const _CatalogMessage({
    super.key,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
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
                key: const ValueKey('catalog-retry'),
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
