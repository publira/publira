import 'package:flutter/material.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';

/// What the reader is offered once the pages run out: the next episode, or the
/// news that there is none yet, and the way back to the series either way.
///
/// It is a screen of the reader past the last page rather than a page of the
/// episode, so the counter along the bottom and the position the reader keeps
/// stay the pages the episode actually has.
class EpisodeEndPanel extends StatelessWidget {
  const EpisodeEndPanel({
    super.key,
    required this.detail,
    required this.nextSavedOffline,
    required this.onOpenNext,
    required this.onOpenComments,
    required this.onBackToSeries,
  });

  /// The episode that just ended, which carries the one after it.
  final EpisodeDetail detail;

  /// Whether the next episode's body is already on this device, which is what
  /// tells a reader about to lose their connection that they can go on.
  final bool nextSavedOffline;

  /// Opens the episode the reader took. It is handed the neighbour this panel
  /// drew rather than reading it again, so the offer and what it opens cannot
  /// come apart.
  final ValueChanged<EpisodeNeighbor> onOpenNext;

  /// Opens the episode's comments, or `null` where the tenant takes none.
  ///
  /// This is the only way to them, and it is here rather than beside the
  /// pages on purpose: what a reader has to say about an episode comes after
  /// they have read it, and the screen past the last page is where they have.
  final VoidCallback? onOpenComments;

  final VoidCallback onBackToSeries;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final next = detail.nextEpisode;
    return Center(
      key: const ValueKey('episode-end-panel'),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 72),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (next == null)
              _UpToDate(seriesTitle: detail.seriesTitle)
            else
              _UpNext(
                episode: next,
                savedOffline: nextSavedOffline,
                onOpen: () => onOpenNext(next),
              ),
            const SizedBox(height: 24),
            if (onOpenComments != null)
              OutlinedButton.icon(
                key: const ValueKey('episode-end-comments'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white24),
                ),
                onPressed: onOpenComments,
                icon: const Icon(Icons.mode_comment_outlined),
                label: Text(messages.commentsTitle),
              ),
            TextButton(
              key: const ValueKey('episode-end-back-to-series'),
              style: TextButton.styleFrom(foregroundColor: Colors.white70),
              onPressed: onBackToSeries,
              child: Text(messages.viewerBackToSeries),
            ),
          ],
        ),
      ),
    );
  }
}

/// The offer to read on, with what the next episode costs.
class _UpNext extends StatelessWidget {
  const _UpNext({
    required this.episode,
    required this.savedOffline,
    required this.onOpen,
  });

  final EpisodeNeighbor episode;
  final bool savedOffline;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          messages.viewerEndUpNext,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(color: Colors.white70),
        ),
        const SizedBox(height: 12),
        Card(
          color: Colors.white10,
          margin: EdgeInsets.zero,
          child: InkWell(
            key: const ValueKey('episode-end-next'),
            onTap: onOpen,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        '#${messages.formatInteger(episode.orderIndex)}',
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: Colors.white70,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        // What it costs is what it costs again once a free
                        // window closes, so the price is shown by whether the
                        // body is public right now rather than by the number.
                        episode.isFree
                            ? messages.commonFree
                            : '¥${messages.formatInteger(episode.price)}',
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: Colors.white,
                        ),
                      ),
                      if (savedOffline) ...[
                        const SizedBox(width: 12),
                        Icon(
                          key: const ValueKey('episode-end-next-saved'),
                          Icons.offline_pin_outlined,
                          size: 20,
                          color: Colors.white70,
                          // The mark is the only thing that says this episode
                          // still opens without a network, so it has to reach
                          // a screen reader too.
                          semanticLabel: messages.seriesSavedOffline,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    episode.title,
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The end of the series as it stands: there is nothing published after this
/// episode yet.
class _UpToDate extends StatelessWidget {
  const _UpToDate({required this.seriesTitle});

  final String seriesTitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    return Column(
      key: const ValueKey('episode-end-up-to-date'),
      children: [
        Text(
          messages.viewerEndUpToDateTitle,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleLarge?.copyWith(color: Colors.white),
        ),
        const SizedBox(height: 8),
        Text(
          messages.viewerEndUpToDateDescription(title: seriesTitle),
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white70),
        ),
      ],
    );
  }
}
