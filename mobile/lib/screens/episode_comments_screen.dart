import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/comments/comment_repository.dart';
import 'package:publira/comments/own_comments.dart';
import 'package:publira/l10n/formatting.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/episode_comment.dart';
import 'package:publira/router.dart';

/// What the API accepts, in Unicode code points rather than UTF-16 units, so
/// an emoji-heavy comment is measured the way `PostEpisodeComment` measures it
/// and is not cut off at half the length the server allows.
const _maxBodyRunes = 1000;

/// The same limit on a report's own sentence, which `ReportEpisodeComment`
/// applies to its note.
const _maxNoteRunes = 1000;

/// The reader a comment is rendered for: whether a row is theirs to delete,
/// and the name their own rows carry.
class _Viewer {
  const _Viewer({required this.id, required this.name});

  final String id;
  final String name;
}

/// One load of the comment section: the tenant's policy, the public page, and
/// the reader's own comments folded into it.
class _Section {
  const _Section({
    required this.mode,
    required this.page,
    required this.comments,
    this.ownFailure,
  });

  final CommentMode mode;
  final EpisodeCommentPage page;

  /// The public page with the reader's own comments placed among it by date.
  final List<EpisodeComment> comments;

  /// Why the reader's own comments could not be read, `null` when they were.
  /// The public list still renders: dropping those rows silently would take
  /// the reader's own pending comment off the screen with nothing saying so.
  final CommentFailureKind? ownFailure;
}

/// The comments on one episode, which the reader reaches from the end of it.
///
/// Everything here is online. A comment is a conversation with the other
/// readers of the episode, so nothing is queued for later against a copy the
/// device saved: a read that cannot reach the API says so, and so does a post.
class EpisodeCommentsScreen extends StatefulWidget {
  const EpisodeCommentsScreen({
    super.key,
    required this.seriesId,
    required this.episodeId,
  });

  final String seriesId;
  final String episodeId;

  @override
  State<EpisodeCommentsScreen> createState() => _EpisodeCommentsScreenState();
}

class _EpisodeCommentsScreenState extends State<EpisodeCommentsScreen> {
  late Future<_Section> _future;
  var _started = false;
  var _accessToken = '';

  /// Cursor of the page being shown, empty on the newest one.
  var _token = '';

  /// Reloads whenever the reader signs in or out: who is asking decides
  /// whether the form is offered at all, and which rows are theirs.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _token = '';
    _future = _load();
  }

  _Viewer? get _viewer {
    final session = AuthScope.of(context).session;
    if (session == null) {
      return null;
    }
    return _Viewer(id: session.userPublicId, name: session.userName);
  }

  /// Runs [read] and hands back its value or the failure it ended with.
  ///
  /// A read started beside another and awaited after it would otherwise be
  /// able to complete with an error nobody has awaited yet, which the
  /// framework reports as an unhandled one.
  Future<(T?, CommentFailure?)> _guarded<T>(Future<T> read) async {
    try {
      return (await read, null);
    } on CommentFailure catch (failure) {
      return (null, failure);
    }
  }

  Future<_Section> _load() async {
    final comments = CommentScope.maybeOf(context);
    if (comments == null) {
      return const _Section(
        mode: CommentMode.disabled,
        page: EpisodeCommentPage(),
        comments: [],
      );
    }
    final viewer = _viewer;

    // All three reads are started before any is awaited: none depends on
    // another, and a reader made to wait out three round trips in a row would
    // see the list that much later for it.
    final ownRead = _guarded(comments.listMyComments(widget.episodeId));
    final pageRead = _guarded(
      comments.listComments(widget.episodeId, token: _token),
    );
    final mode = await comments.commentMode();

    final (page, pageFailure) = await pageRead;
    if (page == null) {
      throw pageFailure!;
    }
    final (own, ownFailure) = await ownRead;

    return _Section(
      mode: mode,
      page: page,
      comments: mergeOwnComments(page, [
        if (own != null && viewer != null)
          for (final comment in own)
            comment.byAuthor(id: viewer.id, name: viewer.name),
      ]),
      ownFailure: ownFailure?.kind,
    );
  }

  void _reload() {
    setState(() {
      _future = _load();
    });
  }

  void _showPage(String token) {
    setState(() {
      _token = token;
      _future = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(messages.commentsTitle)),
      body: FutureBuilder<_Section>(
        future: _future,
        builder: (context, snapshot) {
          // A reload keeps the section that is already on screen rather than
          // replacing it with a spinner. The reader has just posted or deleted
          // something, and what they are told about it is written beside the
          // box they wrote it in: taking the box away would take the answer
          // with it.
          if (snapshot.connectionState != ConnectionState.done &&
              !snapshot.hasData) {
            return const Center(
              key: ValueKey('episode-comments-loading'),
              child: CircularProgressIndicator(),
            );
          }
          if (snapshot.hasError) {
            return _CommentsMessage(
              key: const ValueKey('episode-comments-error'),
              message: _failureCopy(
                messages,
                snapshot.error,
                messages.commentsListFailed,
              ),
              actionLabel: messages.commonRetry,
              onAction: _reload,
            );
          }
          return _body(messages, snapshot.data!);
        },
      ),
    );
  }

  Widget _body(AppMessages messages, _Section section) {
    // A tenant that has not turned commenting on gets no section at all rather
    // than an empty one: the setting answers "does this site take comments",
    // and an empty list would read as "nobody has commented yet". The reader
    // is normally offered no way here at all, so this is what a link kept from
    // before the setting changed lands on.
    if (!section.mode.takesComments) {
      return _CommentsMessage(
        key: const ValueKey('episode-comments-disabled'),
        message: messages.commentsDisabled,
      );
    }

    final comments = CommentScope.maybeOf(context);
    final viewer = _viewer;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (section.mode == CommentMode.approvalRequired)
          Padding(
            key: const ValueKey('episode-comments-approval-notice'),
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(
              messages.commentsApprovalNotice,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        if (comments != null && viewer != null)
          _CommentForm(
            comments: comments,
            episodeId: widget.episodeId,
            onPosted: _reload,
          )
        else
          _SignInPrompt(seriesId: widget.seriesId, episodeId: widget.episodeId),
        if (section.ownFailure != null)
          Padding(
            key: const ValueKey('episode-comments-own-error'),
            padding: const EdgeInsets.only(top: 16),
            child: _ErrorText(
              _failureCopy(
                messages,
                section.ownFailure,
                messages.commentsOwnFailed,
              ),
            ),
          ),
        const SizedBox(height: 24),
        if (section.comments.isEmpty)
          Text(
            key: const ValueKey('episode-comments-empty'),
            _token.isEmpty
                ? messages.commentsEmpty
                : messages.commentsPageEmpty,
          )
        else
          for (final comment in section.comments)
            _CommentTile(
              key: ValueKey('comment-tile-${comment.id}'),
              comment: comment,
              comments: comments,
              viewer: viewer,
              onWithdrawn: _reload,
            ),
        if (section.page.previousToken.isNotEmpty ||
            section.page.nextToken.isNotEmpty)
          _Pagination(page: section.page, onShowPage: _showPage),
      ],
    );
  }
}

/// The copy for a failed comment call.
///
/// A failure every app classifies the same way is told in the words they all
/// use; only the one nothing classifies takes this section's own [fallback].
String _failureCopy(AppMessages messages, Object? error, String fallback) {
  final kind = switch (error) {
    CommentFailure(:final kind) => kind,
    CommentFailureKind kind => kind,
    _ => CommentFailureKind.unexpected,
  };
  return switch (kind) {
    CommentFailureKind.network => messages.errorsRpcUnavailable,
    CommentFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
    CommentFailureKind.rateLimited => messages.errorsRpcRateLimited,
    CommentFailureKind.rejected => messages.errorsRpcInvalidArgument,
    CommentFailureKind.notAllowed => messages.errorsRpcForbidden,
    CommentFailureKind.gone => messages.errorsRpcNotFound,
    CommentFailureKind.unexpected => fallback,
  };
}

/// Where a reader who is signed out is sent to write one.
class _SignInPrompt extends StatelessWidget {
  const _SignInPrompt({required this.seriesId, required this.episodeId});

  final String seriesId;
  final String episodeId;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Column(
      key: const ValueKey('episode-comments-sign-in'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(messages.commentsSignInPrompt),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: () => context.push(AppRoutes.signIn),
          child: Text(messages.commonSignIn),
        ),
      ],
    );
  }
}

/// The box a signed-in reader writes one in.
///
/// The length is checked here before the request, in the code points the API
/// counts, so a comment too long to be stored is said so beside the box rather
/// than after a round trip.
class _CommentForm extends StatefulWidget {
  const _CommentForm({
    required this.comments,
    required this.episodeId,
    required this.onPosted,
  });

  final CommentRepository comments;
  final String episodeId;

  /// The list has a comment in it that was not there before.
  final VoidCallback onPosted;

  @override
  State<_CommentForm> createState() => _CommentFormState();
}

class _CommentFormState extends State<_CommentForm> {
  final _body = TextEditingController();
  var _pending = false;
  String? _message;
  var _failed = false;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final messages = AppMessages.of(context);
    final body = _body.text.trim();
    if (body.isEmpty) {
      _report(messages.commentsBodyRequired, failed: true);
      return;
    }
    if (body.runes.length > _maxBodyRunes) {
      _report(
        messages.commentsBodyTooLong(
          max: messages.formatInteger(_maxBodyRunes),
        ),
        failed: true,
      );
      return;
    }

    setState(() {
      _pending = true;
      _message = null;
    });
    try {
      final posted = await widget.comments.post(
        episodePublicId: widget.episodeId,
        body: body,
      );
      if (!mounted) {
        return;
      }
      _body.clear();
      _report(
        posted.awaitingApproval
            ? messages.commentsPostedAwaitingApproval
            : messages.commentsPosted,
        failed: false,
      );
      widget.onPosted();
    } on CommentFailure catch (failure) {
      if (!mounted) {
        return;
      }
      _report(
        _failureCopy(messages, failure, messages.commentsPostFailed),
        failed: true,
      );
    }
  }

  void _report(String message, {required bool failed}) {
    setState(() {
      _pending = false;
      _message = message;
      _failed = failed;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final message = _message;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          key: const ValueKey('comment-body'),
          controller: _body,
          enabled: !_pending,
          maxLines: 4,
          minLines: 3,
          textInputAction: TextInputAction.newline,
          decoration: InputDecoration(
            labelText: messages.commentsBodyLabel,
            hintText: messages.commentsBodyPlaceholder,
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('comment-submit'),
          onPressed: _pending ? null : _submit,
          child: Text(
            _pending ? messages.commentsPosting : messages.commentsSubmit,
          ),
        ),
        if (message != null)
          Padding(
            key: const ValueKey('comment-form-message'),
            padding: const EdgeInsets.only(top: 8),
            child: _failed ? _ErrorText(message) : Text(message),
          ),
      ],
    );
  }
}

/// One comment, with whatever the reader may do about it.
class _CommentTile extends StatefulWidget {
  const _CommentTile({
    super.key,
    required this.comment,
    required this.comments,
    required this.viewer,
    required this.onWithdrawn,
  });

  final EpisodeComment comment;

  /// `null` in a build that serves no comments, which leaves the row with no
  /// controls on it.
  final CommentRepository? comments;
  final _Viewer? viewer;
  final VoidCallback onWithdrawn;

  @override
  State<_CommentTile> createState() => _CommentTileState();
}

class _CommentTileState extends State<_CommentTile> {
  var _pending = false;
  String? _message;
  var _failed = false;

  bool get _isOwn =>
      widget.viewer != null && widget.comment.authorId == widget.viewer!.id;

  Future<void> _withdraw() async {
    final comments = widget.comments;
    if (comments == null) {
      return;
    }
    final messages = AppMessages.of(context);
    setState(() {
      _pending = true;
      _message = null;
    });
    try {
      await comments.withdraw(widget.comment.id);
      if (!mounted) {
        return;
      }
      // The row goes with the reload, so nothing is set on a tile that is
      // about to leave the tree.
      widget.onWithdrawn();
    } on CommentFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() {
        _pending = false;
        _message = _failureCopy(
          messages,
          failure,
          messages.commentsDeleteFailed,
        );
        _failed = true;
      });
    }
  }

  Future<void> _report() async {
    final comments = widget.comments;
    if (comments == null) {
      return;
    }
    final messages = AppMessages.of(context);
    final report = await showDialog<_Report>(
      context: context,
      builder: (context) => const _ReportDialog(),
    );
    if (report == null || !mounted) {
      return;
    }
    setState(() {
      _pending = true;
      _message = null;
    });
    try {
      await comments.report(
        commentPublicId: widget.comment.id,
        reason: report.reason,
        note: report.note,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _pending = false;
        // The same answer a first report gets, whether or not this reader has
        // already sent one: what the platform has since done about the comment
        // is not something a second submission may reveal.
        _message = messages.commentsReported;
        _failed = false;
      });
    } on CommentFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() {
        _pending = false;
        _message = _failureCopy(
          messages,
          failure,
          messages.commentsReportFailed,
        );
        _failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = AppMessages.of(context);
    final comment = widget.comment;
    final createdAt = comment.createdAt;
    final at = createdAt == null ? '' : messages.formatDateTime(createdAt);
    final message = _message;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        comment.authorName,
                        style: theme.textTheme.titleSmall,
                      ),
                      if (at.isNotEmpty)
                        Text(
                          at,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                if (comment.awaitingApproval)
                  Padding(
                    key: const ValueKey('comment-awaiting-approval'),
                    padding: const EdgeInsets.only(left: 8),
                    child: Text(
                      messages.commentsAwaitingApproval,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(comment.body),
            if (_control(messages, at) case final control?)
              Align(alignment: Alignment.centerRight, child: control),
            if (message != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _failed ? _ErrorText(message) : Text(message),
              ),
          ],
        ),
      ),
    );
  }

  /// What this reader may do about this comment: take their own down, or tell
  /// the moderators about somebody else's.
  ///
  /// Reporting needs a session, and a reader reporting their own comment is
  /// the one case the API refuses outright — they delete it instead.
  Widget? _control(AppMessages messages, String at) {
    if (widget.comments == null || widget.viewer == null) {
      return null;
    }
    if (_isOwn) {
      return TextButton(
        key: ValueKey('comment-delete-${widget.comment.id}'),
        onPressed: _pending ? null : _withdraw,
        child: Text(
          _pending ? messages.commentsDeleting : messages.commentsDelete,
          semanticsLabel: at.isEmpty
              ? null
              : messages.commentsDeleteAria(date: at),
        ),
      );
    }
    return TextButton(
      key: ValueKey('comment-report-${widget.comment.id}'),
      onPressed: _pending ? null : _report,
      child: Text(
        _pending ? messages.commentsReporting : messages.commentsReport,
        semanticsLabel: at.isEmpty
            ? null
            : messages.commentsReportAria(
                author: widget.comment.authorName,
                date: at,
              ),
      ),
    );
  }
}

/// What a reader tells the moderators about one comment.
class _Report {
  const _Report({required this.reason, required this.note});

  final CommentReportReason reason;
  final String note;
}

/// Asks why, before a comment is reported.
///
/// The dialog is what makes this deliberate: reporting is an accusation about
/// someone else's writing, and a single-tap control next to every comment
/// invites the mistap that a reason chooser and a sentence of confirmation
/// copy do not.
class _ReportDialog extends StatefulWidget {
  const _ReportDialog();

  @override
  State<_ReportDialog> createState() => _ReportDialogState();
}

class _ReportDialogState extends State<_ReportDialog> {
  var _reason = CommentReportReason.values.first;
  final _note = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _confirm() {
    final messages = AppMessages.of(context);
    final note = _note.text.trim();
    if (note.runes.length > _maxNoteRunes) {
      setState(() {
        _error = messages.commentsReportNoteTooLong(
          max: messages.formatInteger(_maxNoteRunes),
        );
      });
      return;
    }
    Navigator.of(context).pop(_Report(reason: _reason, note: note));
  }

  String _label(AppMessages messages, CommentReportReason reason) {
    return switch (reason) {
      CommentReportReason.spam => messages.commentsReportReasonSpam,
      CommentReportReason.abuse => messages.commentsReportReasonAbuse,
      CommentReportReason.spoiler => messages.commentsReportReasonSpoiler,
      CommentReportReason.other => messages.commentsReportReasonOther,
    };
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final error = _error;
    return AlertDialog(
      key: const ValueKey('comment-report-dialog'),
      title: Text(messages.commentsReportTitle),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(messages.commentsReportDescription),
            const SizedBox(height: 16),
            Text(messages.commentsReportReasonLabel),
            RadioGroup<CommentReportReason>(
              groupValue: _reason,
              onChanged: (value) => setState(() => _reason = value ?? _reason),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final reason in CommentReportReason.values)
                    RadioListTile<CommentReportReason>(
                      key: ValueKey('comment-report-reason-${reason.name}'),
                      contentPadding: EdgeInsets.zero,
                      value: reason,
                      title: Text(_label(messages, reason)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const ValueKey('comment-report-note'),
              controller: _note,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: messages.commentsReportNoteLabel,
                hintText: messages.commentsReportNotePlaceholder,
                border: const OutlineInputBorder(),
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _ErrorText(error),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(messages.commonCancel),
        ),
        FilledButton(
          key: const ValueKey('comment-report-confirm'),
          onPressed: _confirm,
          child: Text(messages.commentsReportConfirm),
        ),
      ],
    );
  }
}

/// The way to the pages either side of this one.
///
/// The list is newest first, so the previous page holds the newer comments and
/// the next page the older ones, which is what the labels say rather than
/// naming a direction the reader has to work out.
class _Pagination extends StatelessWidget {
  const _Pagination({required this.page, required this.onShowPage});

  final EpisodeCommentPage page;
  final ValueChanged<String> onShowPage;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        TextButton(
          key: const ValueKey('comment-newer-page'),
          onPressed: page.previousToken.isEmpty
              ? null
              : () => onShowPage(page.previousToken),
          child: Text(messages.commentsNewer),
        ),
        TextButton(
          key: const ValueKey('comment-older-page'),
          onPressed: page.nextToken.isEmpty
              ? null
              : () => onShowPage(page.nextToken),
          child: Text(messages.commentsOlder),
        ),
      ],
    );
  }
}

/// A sentence in the colour a failure is told in.
class _ErrorText extends StatelessWidget {
  const _ErrorText(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      message,
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.error,
      ),
    );
  }
}

/// The whole screen saying one thing, with the way out of it where there is
/// one.
class _CommentsMessage extends StatelessWidget {
  const _CommentsMessage({
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
    final label = actionLabel;
    final onAction = this.onAction;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            if (label != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onAction, child: Text(label)),
            ],
          ],
        ),
      ),
    );
  }
}
