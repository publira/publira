import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/age_rating_gate.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/catalog/creator_credits.dart';
import 'package:publira/catalog/eye_catch.dart';
import 'package:publira/catalog/series_cover.dart';
import 'package:publira/follow/follow_control.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/offline/offline_scope.dart';
import 'package:publira/router.dart';

/// Series detail. Loads the published series and its episodes from the API.
class SeriesDetailScreen extends StatefulWidget {
  const SeriesDetailScreen({super.key, required this.seriesId});

  final String seriesId;

  @override
  State<SeriesDetailScreen> createState() => _SeriesDetailScreenState();
}

/// One series as this screen opens it, with the rating the reader's birth
/// date already proves.
class _OpenSeries {
  const _OpenSeries({required this.detail, this.provenRating});

  final SeriesDetail detail;
  final SeriesAgeRating? provenRating;
}

class _SeriesDetailScreenState extends State<SeriesDetailScreen> {
  late Future<_OpenSeries?> _future;
  var _started = false;
  var _accessToken = '';

  /// Reloads whenever the reader signs in or out, because the rating a birth
  /// date proves belongs to the reader who was signed in when it was read.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = AuthScope.of(context);
    if (_started && auth.accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = auth.accessToken;
    _future = _load(CatalogScope.of(context), auth);
  }

  void _reload() {
    setState(() {
      _future = _load(CatalogScope.of(context), AuthScope.of(context));
    });
  }

  /// The series, and what the reader's birth date proves when it carries a
  /// rating to gate. A birth date that cannot be read proves nothing, which
  /// leaves the confirmation standing rather than failing the screen.
  Future<_OpenSeries?> _load(
    CatalogRepository catalog,
    AuthController auth,
  ) async {
    final detail = await catalog.getSeries(widget.seriesId);
    if (detail == null) {
      return null;
    }
    if (!isRestrictedAgeRating(detail.series.ageRating)) {
      return _OpenSeries(detail: detail);
    }
    try {
      final age = await auth.readReaderAge();
      return _OpenSeries(
        detail: detail,
        provenRating: age?.provenAgeRating(DateTime.now()),
      );
    } on AuthFailure {
      return _OpenSeries(detail: detail);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return FutureBuilder<_OpenSeries?>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Scaffold(
            appBar: AppBar(title: Text(messages.seriesTitle)),
            body: const Center(
              key: ValueKey('series-detail-loading'),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            appBar: AppBar(title: Text(messages.seriesTitle)),
            body: _DetailMessage(
              key: const ValueKey('series-detail-error'),
              message: _errorCopy(messages, snapshot.error),
              actionLabel: messages.commonRetry,
              onAction: _reload,
            ),
          );
        }
        final open = snapshot.data;
        if (open == null) {
          return Scaffold(
            appBar: AppBar(title: Text(messages.seriesTitle)),
            body: _DetailMessage(
              key: const ValueKey('series-not-found'),
              message: messages.seriesNotFound(id: widget.seriesId),
              actionLabel: messages.commonBackToCatalog,
              onAction: () => context.goNamed('catalog'),
            ),
          );
        }
        final detail = open.detail;
        return Scaffold(
          appBar: AppBar(title: Text(detail.series.title)),
          body: AgeRatingGate(
            rating: detail.series.ageRating,
            seriesTitle: detail.series.title,
            provenRating: open.provenRating,
            child: _SeriesDetailBody(detail: detail),
          ),
        );
      },
    );
  }

  String _errorCopy(AppMessages messages, Object? error) {
    if (error is! CatalogFailure) {
      return messages.seriesLoadFailed;
    }
    return switch (error.kind) {
      CatalogFailureKind.network => messages.errorsRpcUnavailable,
      CatalogFailureKind.notSaved ||
      CatalogFailureKind.saveExpired => messages.seriesOfflineNotSaved,
      CatalogFailureKind.unexpected => messages.seriesLoadFailed,
    };
  }
}

class _DetailMessage extends StatelessWidget {
  const _DetailMessage({
    super.key,
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

class _SeriesDetailBody extends StatefulWidget {
  const _SeriesDetailBody({required this.detail});

  final SeriesDetail detail;

  @override
  State<_SeriesDetailBody> createState() => _SeriesDetailBodyState();
}

class _SeriesDetailBodyState extends State<_SeriesDetailBody> {
  /// Episodes this device could open right now without a network. Empty on a
  /// run with no library, which is what leaves the badge off.
  var _saved = const <String>{};
  var _readerId = '';
  var _started = false;

  /// Which episodes are readable depends on who is signed in, so a sign-in or
  /// a sign-out asks the library again rather than keeping the last answer.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final readerId = AuthScope.of(context).session?.userPublicId ?? '';
    if (_started && readerId == _readerId) {
      return;
    }
    _started = true;
    _readerId = readerId;
    final library = OfflineScope.maybeOf(context);
    if (library == null) {
      return;
    }
    unawaited(_loadSaved(library, readerId));
  }

  Future<void> _loadSaved(OfflineLibrary library, String readerId) async {
    final saved = await library.readableEpisodeIds(
      widget.detail.series.id,
      readerId: readerId,
    );
    // The reader may have signed in or out while the library was answering,
    // in which case this answer is about somebody else.
    if (!mounted || readerId != _readerId) {
      return;
    }
    setState(() {
      _saved = saved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final series = widget.detail.series;
    // A build with no follow repository offers none of this, so neither the
    // control nor the author rows it would sit in are put on the screen.
    final follows = FollowScope.maybeOf(context) != null;

    return ListView(
      key: const ValueKey('series-detail-body'),
      padding: const EdgeInsets.all(16),
      children: [
        // 16:9 is the shape of the rendition, and on a phone it is what the
        // banner takes. The cap is for the wide screen a tablet or a
        // desktop window gives it, where the same ratio would push the
        // synopsis and the episodes off the first screen.
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 220),
          child: SeriesCover(
            series: series,
            preferredTypes: const [eyeCatchLandscape, eyeCatchPortrait],
            aspectRatio: 16 / 9,
          ),
        ),
        const SizedBox(height: 16),
        Text(series.title, style: theme.textTheme.headlineSmall),
        if (series.ratingCount > 0) ...[
          const SizedBox(height: 8),
          Text(
            key: const ValueKey('series-rating'),
            series.ratingCount == 1
                ? messages.seriesRatingSingle(
                    average: series.ratingAverage.toStringAsFixed(1),
                    count: messages.formatInteger(series.ratingCount),
                  )
                : messages.seriesRating(
                    average: series.ratingAverage.toStringAsFixed(1),
                    count: messages.formatInteger(series.ratingCount),
                  ),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        if (series.creators.isNotEmpty) ...[
          const SizedBox(height: 4),
          CreatorCredits(
            key: const ValueKey('series-creators'),
            credits: series.creators,
            style: theme.textTheme.bodyMedium,
          ),
        ],
        const SizedBox(height: 8),
        Text(
          messages.seriesEpisodeCount(
            count: messages.formatInteger(series.episodeCount),
          ),
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.primary,
          ),
        ),
        if (series.status != null ||
            series.scheduleWeekdays.isNotEmpty ||
            messages.seriesAgeRatingLabel(series.ageRating) != null) ...[
          const SizedBox(height: 8),
          Wrap(
            key: const ValueKey('series-classification'),
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (series.status != null)
                Text(
                  key: const ValueKey('series-status'),
                  messages.seriesStatusLabel(series.status!),
                  style: theme.textTheme.labelLarge,
                ),
              if (messages.seriesAgeRatingLabel(series.ageRating)
                  case final rating?)
                Text(
                  key: const ValueKey('series-age-rating'),
                  rating,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              if (series.scheduleWeekdays.isNotEmpty)
                Text(
                  key: const ValueKey('series-schedule'),
                  messages.seriesSchedule(
                    weekdays: messages.formatList([
                      for (final weekday in series.scheduleWeekdays)
                        messages.formatWeekday(weekday),
                    ]),
                  ),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ],
        if (series.genres.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            key: const ValueKey('series-genres'),
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final genre in series.genres)
                Chip(
                  key: ValueKey('series-genre-${genre.id}'),
                  label: Text(genre.name),
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
            ],
          ),
        ],
        if (follows) ...[
          const SizedBox(height: 16),
          FollowControl(
            kind: FollowTargetKind.series,
            targetId: series.id,
            targetName: series.title,
          ),
        ],
        if (series.description.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(series.description, style: theme.textTheme.bodyLarge),
        ],
        // Each author is followed on their own. The row leads nowhere: the app
        // has no author screen, and the name is the whole of what it says.
        if (follows && series.creators.isNotEmpty) ...[
          const SizedBox(height: 24),
          Text(
            messages.seriesCreatorsHeading,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          // A person credited in two roles is still one person to follow.
          for (final creator in {
            for (final credit in series.creators) credit.id: credit,
          }.values)
            ListTile(
              key: ValueKey('series-creator-${creator.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(creator.name),
              trailing: FollowControl(
                kind: FollowTargetKind.creator,
                targetId: creator.id,
                targetName: creator.name,
              ),
            ),
        ],
        const SizedBox(height: 24),
        Text(
          messages.seriesEpisodesHeading,
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        if (widget.detail.episodes.isEmpty)
          Text(messages.seriesEpisodesEmpty)
        else
          for (final episode in widget.detail.episodes)
            ListTile(
              key: ValueKey('episode-tile-${episode.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(episode.title),
              trailing: _EpisodeTrailing(
                price: episode.price,
                saved: _saved.contains(episode.id),
              ),
              onTap: () {
                context.push(
                  AppRoutes.episodeViewerPath(series.id, episode.id),
                );
              },
            ),
      ],
    );
  }
}

/// Price and offline mark of one episode row.
///
/// The mark is what tells a reader, before they lose their connection, which
/// episodes this device can still open once they have.
class _EpisodeTrailing extends StatelessWidget {
  const _EpisodeTrailing({required this.price, required this.saved});

  final int price;
  final bool saved;

  @override
  Widget build(BuildContext context) {
    if (!saved && price <= 0) {
      return const SizedBox.shrink();
    }
    final messages = AppMessages.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (saved)
          Padding(
            key: const ValueKey('episode-saved-offline'),
            padding: const EdgeInsets.only(right: 8),
            child: Icon(
              Icons.offline_pin_outlined,
              size: 20,
              // The mark is the only thing that says this episode still opens
              // without a network, so it has to reach a screen reader too.
              semanticLabel: messages.seriesSavedOffline,
            ),
          ),
        if (price > 0) Text('¥${messages.formatInteger(price)}'),
      ],
    );
  }
}
