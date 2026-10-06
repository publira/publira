import 'package:flutter/material.dart';
import 'package:publira/api/error_details.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// The one-way reaction a reader can give after finishing an episode.
///
/// Its private state is read only for a signed-in reader. Guests still see the
/// public headcount carried by the episode detail and are sent to sign in.
///
/// The API refuses a rating from a reader credited on the episode, so the
/// author is not offered a press that would end in that refusal: the control
/// renders nothing once their state says so. It holds the space below it for
/// the same reason, so a withheld control leaves no gap where it would be.
class EpisodeReactionControl extends StatefulWidget {
  const EpisodeReactionControl({super.key, required this.episode});

  final EpisodeItem episode;

  @override
  State<EpisodeReactionControl> createState() => _EpisodeReactionControlState();
}

class _EpisodeReactionControlState extends State<EpisodeReactionControl> {
  EpisodeReaction? _reaction;
  Object? _error;
  var _loading = false;
  var _submitting = false;
  var _accessToken = '';
  var _started = false;
  var _requestGeneration = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _requestGeneration++;
    _reaction = null;
    _error = null;
    if (accessToken.isNotEmpty) {
      _load();
    }
  }

  @override
  void didUpdateWidget(covariant EpisodeReactionControl oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.episode.id == widget.episode.id) {
      return;
    }
    _requestGeneration++;
    _reaction = null;
    _error = null;
    if (_accessToken.isNotEmpty) {
      _load();
    }
  }

  Future<void> _load() async {
    final request = _request();
    setState(() => _loading = true);
    try {
      final reaction = await CatalogScope.of(
        context,
      ).getEpisodeReaction(widget.episode.internalId);
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _reaction = reaction);
    } catch (error) {
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _error = error);
    } finally {
      if (_isCurrent(request)) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _react() async {
    final request = _request();
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final reaction = await CatalogScope.of(
        context,
      ).reactToEpisode(widget.episode.internalId);
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _reaction = reaction);
    } catch (error) {
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _error = error);
    } finally {
      if (_isCurrent(request)) {
        setState(() => _submitting = false);
      }
    }
  }

  _ReactionRequest _request() => _ReactionRequest(
    generation: _requestGeneration,
    accessToken: _accessToken,
    episodeId: widget.episode.id,
  );

  bool _isCurrent(_ReactionRequest request) =>
      mounted &&
      request.generation == _requestGeneration &&
      request.accessToken == _accessToken &&
      request.episodeId == widget.episode.id;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    final reaction = _reaction;
    if (signedIn && reaction != null && reaction.readerCredited) {
      return const SizedBox.shrink();
    }
    final ratingCount = reaction?.ratingCount ?? widget.episode.ratingCount;
    final atMaximum =
        reaction != null &&
        reaction.score > 0 &&
        (!reaction.allowsMultiplePresses || reaction.score >= 5);
    // A press refused because the reader is credited on the episode — linked
    // after the control was drawn — is refused again on every press, and says
    // so rather than asking for another try.
    final error = _error;
    final refusedAsCredited =
        error is CatalogFailure &&
        error.reasons.contains(readerCreditedOnEpisodeReason);

    return Column(
      key: const ValueKey('episode-reaction'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!signedIn)
          OutlinedButton.icon(
            key: const ValueKey('episode-reaction-sign-in'),
            onPressed: () => context.pushInTab(AppRoutes.signIn),
            icon: const Icon(Icons.favorite_border),
            label: AutospacedText(messages.viewerReactionSignIn),
          )
        else
          FilledButton.icon(
            key: const ValueKey('episode-reaction-press'),
            onPressed: _loading || _submitting || atMaximum || refusedAsCredited
                ? null
                : _react,
            icon: Icon(
              reaction?.score == 0 || reaction == null
                  ? Icons.favorite_border
                  : Icons.favorite,
            ),
            label: AutospacedText(
              _submitting
                  ? messages.viewerReactionSubmitting
                  : reaction != null && reaction.allowsMultiplePresses
                  ? messages.viewerReactionScore(
                      score: messages.formatInteger(reaction.score),
                    )
                  : messages.viewerReactionPress,
            ),
          ),
        const SizedBox(height: 8),
        AutospacedText(
          key: const ValueKey('episode-reaction-count'),
          messages.viewerReactionCount(count: ratingCount),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (error != null) ...[
          const SizedBox(height: 8),
          AutospacedText(
            key: const ValueKey('episode-reaction-error'),
            refusedAsCredited
                ? messages.viewerReactionReaderCredited
                : messages.viewerReactionFailed,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

class _ReactionRequest {
  const _ReactionRequest({
    required this.generation,
    required this.accessToken,
    required this.episodeId,
  });

  final int generation;
  final String accessToken;
  final String episodeId;
}
