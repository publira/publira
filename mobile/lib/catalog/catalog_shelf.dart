import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/eye_catch_cover.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/typography/autospaced_text.dart';

/// Width of one card on a shelf, and the shape its cover is cut to.
const _shelfCardWidth = 132.0;
const _shelfCardAspectRatio = 3 / 4;

/// The cover plus the two lines under it, which is what a card is allowed to
/// grow to before its text starts to ellipsize. Every shelf reserves it,
/// loading or loaded, so a row arriving does not move the ones below it.
const _shelfHeight = _shelfCardWidth / _shelfCardAspectRatio + 80;

/// One horizontal shelf: a heading, and a row of cards under it.
///
/// An empty answer takes the heading with it. A shelf is a way into part of
/// the catalog, and a tenant with no chart or nothing in the middle of reading
/// is not a tenant with an empty chart.
///
/// The shelf reads its page by itself, and again whenever the repository in
/// [CatalogScope] changes, so a screen that holds one only says what to read.
class CatalogShelf<T> extends StatefulWidget {
  const CatalogShelf({
    super.key,
    required this.sectionKey,
    required this.heading,
    this.failureMessage,
    required this.load,
    required this.cardBuilder,
    required this.reloadToken,
    this.rowHeight = _shelfHeight,
    this.skeleton,
    this.action,
  });

  /// Names this section on screen, and its loading, failure, and retry states.
  final String sectionKey;

  final String heading;

  /// What the shelf says about a failure it has no closer words for. A request
  /// that could not reach the API is reported as that instead.
  ///
  /// `null` takes the shelf away on a failure the way an empty answer does,
  /// for a row that is a suggestion under something else rather than a part
  /// of the screen a reader came for: a notice and a retry there would stand
  /// in for a row they were never told to expect.
  final String? failureMessage;

  final Future<List<T>> Function(CatalogRepository catalog) load;

  final Widget Function(BuildContext context, T item) cardBuilder;

  /// Reloads the shelf whenever it changes: it names whatever the row is
  /// answered for, such as the reader, the genre, or the pulls to refresh
  /// behind it.
  final String reloadToken;

  /// How tall the row of cards stands, which its skeleton reserves as well.
  final double rowHeight;

  /// What stands in the row while it is read. Cover-sized cards when `null`.
  final Widget? skeleton;

  /// A way out of the shelf beside its heading, shown once it has cards.
  final Widget? action;

  @override
  State<CatalogShelf<T>> createState() => _CatalogShelfState<T>();
}

class _CatalogShelfState<T> extends State<CatalogShelf<T>> {
  /// What the API answered, and `null` while a read is still in flight.
  List<T>? _items;
  CatalogFailure? _failure;

  CatalogRepository? _catalog;

  /// Counts the reads this shelf has started, so an answer to one it has
  /// stopped waiting for — a retry, or a reader who signed out meanwhile —
  /// cannot land on the screen.
  var _reads = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = CatalogScope.of(context);
    if (identical(catalog, _catalog)) {
      return;
    }
    _catalog = catalog;
    _load();
  }

  @override
  void didUpdateWidget(covariant CatalogShelf<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.reloadToken != oldWidget.reloadToken) {
      _load();
    }
  }

  void _load() {
    _items = null;
    _failure = null;
    unawaited(_read(++_reads, _catalog!));
  }

  Future<void> _read(int read, CatalogRepository catalog) async {
    List<T>? items;
    CatalogFailure? failure;
    try {
      items = await widget.load(catalog);
    } on CatalogFailure catch (error) {
      failure = error;
    }
    if (!mounted || read != _reads) {
      return;
    }
    setState(() {
      _items = items;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final failure = _failure;
    if (failure != null) {
      final failureMessage = widget.failureMessage;
      if (failureMessage == null) {
        return const SizedBox.shrink();
      }
      return _ShelfFrame(
        heading: widget.heading,
        child: RetryRow(
          sectionKey: widget.sectionKey,
          message: catalogFailureCopy(messages, failure, failureMessage),
          onRetry: () => setState(_load),
        ),
      );
    }
    final items = _items;
    if (items == null) {
      return _ShelfFrame(
        heading: widget.heading,
        child: widget.skeleton ?? _ShelfSkeleton(sectionKey: widget.sectionKey),
      );
    }
    if (items.isEmpty) {
      return const SizedBox.shrink();
    }
    // The section is named only once it is showing its cards, so a screen that
    // has it and a screen still waiting on it are told apart by the same key.
    return _ShelfFrame(
      key: ValueKey(widget.sectionKey),
      heading: widget.heading,
      action: widget.action,
      child: SizedBox(
        height: widget.rowHeight,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          separatorBuilder: (context, index) => const SizedBox(width: 12),
          itemBuilder: (context, index) =>
              widget.cardBuilder(context, items[index]),
        ),
      ),
    );
  }
}

/// The heading every state of a shelf stands under.
class _ShelfFrame extends StatelessWidget {
  const _ShelfFrame({
    super.key,
    required this.heading,
    required this.child,
    this.action,
  });

  final String heading;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final action = this.action;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (action == null)
          SectionHeading(heading)
        else
          Row(
            children: [
              Expanded(child: SectionHeading(heading)),
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 8, top: 8),
                child: action,
              ),
            ],
          ),
        child,
      ],
    );
  }
}

/// The heading a section of the catalog stands under.
class SectionHeading extends StatelessWidget {
  const SectionHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: AutospacedText(
        text,
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }
}

/// What a shelf shows while its page is still in flight: cards the size the
/// real ones will be.
class _ShelfSkeleton extends StatelessWidget {
  const _ShelfSkeleton({required this.sectionKey});

  final String sectionKey;

  /// Enough to reach the edge of a phone, which is what tells the reader the
  /// row scrolls before it holds anything.
  static const _cardCount = 3;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      key: ValueKey('$sectionKey-loading'),
      height: _shelfHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        // Nothing here is reachable, and the row under it is the one the
        // reader will scroll.
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _cardCount,
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) => SizedBox(
          width: _shelfCardWidth,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: _shelfCardAspectRatio,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SkeletonLine(color: colors.surfaceContainerHighest, width: 108),
              const SizedBox(height: 8),
              SkeletonLine(color: colors.surfaceContainerHighest, width: 72),
            ],
          ),
        ),
      ),
    );
  }
}

/// One line of text in a skeleton, before the text has been read.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, required this.color, required this.width});

  final Color color;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// One card of a shelf: the cover of a series, its title, and one line under
/// it.
class SeriesShelfCard extends StatelessWidget {
  const SeriesShelfCard({
    super.key,
    required this.series,
    this.subtitle,
    required this.onTap,
    this.rank,
  });

  final SeriesItem series;

  /// The second line: the episode a reader would continue from, or who the
  /// series is credited to. `null` leaves the line off.
  final Widget? subtitle;

  final VoidCallback onTap;

  /// The position a ranking snapshot gave the series, drawn over its cover.
  /// `null` on a shelf that is not a chart.
  final int? rank;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rank = this.rank;
    final subtitle = this.subtitle;
    return SizedBox(
      width: _shelfCardWidth,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                EyeCatchCover(
                  kind: 'series',
                  id: series.id,
                  variants: series.eyeCatchVariants,
                  requestHeaders: series.imageRequestHeaders,
                  preferredTypes: const [eyeCatchPortrait],
                  aspectRatio: _shelfCardAspectRatio,
                ),
                if (rank != null) _RankBadge(rank),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: AutospacedText(
                series.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            if (subtitle != null)
              Flexible(
                child: DefaultTextStyle.merge(
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  child: subtitle,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The position a chart gave a series, in the corner of its cover.
class _RankBadge extends StatelessWidget {
  const _RankBadge(this.rank);

  final int rank;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Positioned(
      top: 4,
      left: 4,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.primary,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          child: AutospacedText(
            AppMessages.of(context).formatInteger(rank),
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onPrimary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ),
    );
  }
}
