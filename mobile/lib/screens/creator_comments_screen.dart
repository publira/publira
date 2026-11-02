import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/catalog/catalog_states.dart';
import 'package:publira/comments/comment_view.dart';
import 'package:publira/creator/creator_failure.dart';
import 'package:publira/creator/creator_figures.dart';
import 'package:publira/creator/creator_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/layout/window_width.dart';
import 'package:publira/models/my_creator.dart';
import 'package:publira/navigation/app_tabs.dart';
import 'package:publira/router.dart';
import 'package:publira/typography/autospaced_text.dart';

/// What readers say about the episodes crediting one of the reader's Authors,
/// [creatorId]: every published comment on them, newest first, a page at a
/// time with the cursor the episode's own comments page with.
///
/// The list is read-only. Each row opens its episode's comments, where the
/// Author answers with an ordinary comment that carries the Author badge, and
/// the line above the list says so.
class CreatorCommentsScreen extends StatefulWidget {
  const CreatorCommentsScreen({super.key, required this.creatorId});

  /// The [MyCreator.id] of the Author.
  final String creatorId;

  @override
  State<CreatorCommentsScreen> createState() => _CreatorCommentsScreenState();
}

class _CreatorCommentsScreenState extends State<CreatorCommentsScreen> {
  /// The Author, read beside the first page so the header can name them and
  /// an Author the account is not linked to shows no list.
  MyCreator? _creator;
  MyCreatorEpisodeCommentPage? _page;
  CreatorFailure? _failure;
  var _locale = '';

  /// Cursor of the page being shown, empty on the newest one.
  var _token = '';

  /// Counts the reads this screen has started, so an answer to one the
  /// reader moved past cannot land on the screen.
  var _reads = 0;

  /// Reads the list again when the language changes, since the titles are
  /// given in it.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).toLanguageTag();
    if (locale == _locale) {
      return;
    }
    _locale = locale;
    _token = '';
    _read();
  }

  /// Runs [read] and hands back its value or the failure it ended with, so
  /// two reads started side by side cannot leave an error nobody awaits.
  Future<(T?, CreatorFailure?)> _guarded<T>(Future<T> read) async {
    try {
      return (await read, null);
    } on CreatorFailure catch (failure) {
      return (null, failure);
    }
  }

  void _read() {
    final repository = CreatorScope.maybeOf(context);
    if (repository == null || !AuthScope.of(context).isSignedIn) {
      return;
    }
    final read = ++_reads;
    final known = _creator;
    setState(() {
      _page = null;
      _failure = null;
    });
    unawaited(() async {
      final ((creator, creatorFailure), (page, pageFailure)) = await (
        known != null
            ? Future.value((known, null))
            : _guarded(
                repository.listMyCreators().then(
                  (creators) => creators.creators
                      .where((creator) => creator.id == widget.creatorId)
                      .firstOrNull,
                ),
              ),
        _guarded(
          repository.listEpisodeComments(
            creatorId: widget.creatorId,
            locale: _locale,
            token: _token,
          ),
        ),
      ).wait;
      if (!mounted || read != _reads) {
        return;
      }
      setState(() {
        _creator = creator;
        _page = page;
        // An Author the account is not linked to has no comments to read.
        _failure =
            creatorFailure ??
            (creator == null
                ? const CreatorFailure(CreatorFailureKind.unavailable)
                : pageFailure);
      });
    }());
  }

  void _showPage(String token) {
    _token = token;
    _read();
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: AutospacedText(messages.creatorCommentsTitle)),
      body: SafeArea(child: _buildBody(context)),
    );
  }

  Widget _buildBody(BuildContext context) {
    final messages = AppMessages.of(context);
    if (!AuthScope.of(context).isSignedIn) {
      return const SignedOutNotice();
    }
    final failure = _failure;
    if (failure != null) {
      // Retrying would send the token the API just refused.
      final signIn = failure.kind == CreatorFailureKind.sessionExpired;
      return CatalogMessage(
        key: const ValueKey('creator-comments-error'),
        message: creatorFailureCopy(
          messages,
          failure,
          fallback: messages.creatorCommentsLoadFailed,
        ),
        failure: failure,
        actionKey: ValueKey(
          signIn ? 'creator-comments-sign-in' : 'creator-comments-retry',
        ),
        actionLabel: signIn ? messages.commonSignIn : messages.commonRetry,
        onAction: signIn ? () => context.pushInTab(AppRoutes.signIn) : _read,
      );
    }
    final creator = _creator;
    if (creator == null) {
      return const _Loading();
    }
    final theme = Theme.of(context);
    final page = _page;
    return ReadableScrollPadding(
      padding: const EdgeInsets.only(bottom: 24),
      builder: (context, padding) => ListView(
        key: const ValueKey('creator-comments-list'),
        padding: padding,
        children: [
          CreatorPagesHeader(
            creator: creator,
            subtitle: messages.creatorCommentsDescription,
          ),
          Padding(
            key: const ValueKey('creator-comments-reply-hint'),
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: AutospacedText(
              messages.creatorCommentsReplyHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          if (page == null)
            const _Loading()
          else ...[
            if (page.comments.isEmpty)
              Padding(
                key: const ValueKey('creator-comments-empty'),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: AutospacedText(
                  _token.isEmpty
                      ? messages.creatorCommentsEmpty
                      : messages.creatorCommentsPageEmpty,
                ),
              ),
            for (final row in page.comments) _CommentRow(row: row),
            if (page.previousToken.isNotEmpty || page.nextToken.isNotEmpty)
              CommentPagination(
                previousToken: page.previousToken,
                nextToken: page.nextToken,
                onShowPage: _showPage,
              ),
          ],
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      key: ValueKey('creator-comments-loading'),
      padding: EdgeInsets.all(24),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

/// One comment under the series and episode it was left on, drawn as the
/// episode's own comments draw it, opening them.
class _CommentRow extends StatelessWidget {
  const _CommentRow({required this.row});

  final MyCreatorEpisodeComment row;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: ValueKey('creator-comments-row-${row.comment.id}'),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.pushInTab(
          AppRoutes.episodeCommentsPath(
            row.seriesPublicId,
            row.episodePublicId,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AutospacedText(
                row.seriesTitle,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              AutospacedText(
                row.episodeTitle,
                style: theme.textTheme.titleSmall,
              ),
              const Divider(height: 24),
              CommentContent(comment: row.comment),
            ],
          ),
        ),
      ),
    );
  }
}
