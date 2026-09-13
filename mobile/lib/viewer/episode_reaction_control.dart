import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/catalog/catalog_repository.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_detail.dart';
import 'package:publira/models/series_item.dart';
import 'package:publira/router.dart';

/// The one-way reaction a reader can give after finishing an episode.
///
/// Its private state is read only for a signed-in reader. Guests still see the
/// public headcount carried by the episode detail and are sent to sign in.
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

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _reaction = null;
    _error = null;
    if (accessToken.isNotEmpty) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final reaction = await CatalogScope.of(
        context,
      ).getEpisodeReaction(widget.episode.id);
      if (!mounted) {
        return;
      }
      setState(() => _reaction = reaction);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = error);
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _react() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final reaction = await CatalogScope.of(
        context,
      ).reactToEpisode(widget.episode.id);
      if (!mounted) {
        return;
      }
      setState(() => _reaction = reaction);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = error);
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    final reaction = _reaction;
    final ratingCount = reaction?.ratingCount ?? widget.episode.ratingCount;
    final atMaximum =
        reaction != null &&
        reaction.score > 0 &&
        (!reaction.allowsMultiplePresses || reaction.score >= 5);

    return Column(
      key: const ValueKey('episode-reaction'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!signedIn)
          OutlinedButton.icon(
            key: const ValueKey('episode-reaction-sign-in'),
            onPressed: () => context.push(AppRoutes.signIn),
            icon: const Icon(Icons.favorite_border),
            label: Text(messages.viewerReactionSignIn),
          )
        else
          FilledButton.icon(
            key: const ValueKey('episode-reaction-press'),
            onPressed: _loading || _submitting || atMaximum ? null : _react,
            icon: Icon(
              reaction?.score == 0 || reaction == null
                  ? Icons.favorite_border
                  : Icons.favorite,
            ),
            label: Text(
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
        Text(
          key: const ValueKey('episode-reaction-count'),
          messages.viewerReactionCount(
            count: messages.formatInteger(ratingCount),
          ),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            key: const ValueKey('episode-reaction-error'),
            messages.viewerReactionFailed,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
      ],
    );
  }
}
