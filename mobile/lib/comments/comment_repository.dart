import 'package:flutter/widgets.dart';
import 'package:publira/comments/comment_failure.dart';
import 'package:publira/models/episode_comment.dart';

/// The reader's half of `publira.v1.CommentService`, plus the tenant setting
/// that decides whether any of it is offered.
///
/// Every call reaches the API. Comments are not part of what the device keeps
/// for reading without a network: a comment is a conversation with the other
/// readers of an episode, and one written against a saved copy would be posted
/// into a list its author has not seen.
abstract class CommentRepository {
  /// How this tenant publishes comments, which decides whether the app offers
  /// the section at all.
  ///
  /// Throws [CommentFailure] when the API could not be asked, so a caller can
  /// tell "this tenant takes no comments" from "nobody could be asked".
  Future<CommentMode> commentMode();

  /// One page of the episode's published comments, newest first.
  ///
  /// [token] is the opaque cursor from a previous page, empty for the newest
  /// one. Throws [CommentFailure].
  Future<EpisodeCommentPage> listComments(
    String episodePublicId, {
    String token,
  });

  /// The signed-in reader's own comments on this episode that the public list
  /// omits: one awaiting approval, and one staff removed.
  ///
  /// The rows carry no author, because the API does not repeat the caller's
  /// own name back to them; [EpisodeComment.byAuthor] names them. A reader who
  /// is signed out has none. Throws [CommentFailure].
  Future<List<EpisodeComment>> listMyComments(String episodePublicId);

  /// Posts one comment as the signed-in reader and returns what was stored.
  ///
  /// [EpisodeComment.awaitingApproval] on the answer is what tells the author
  /// whether anyone else can read it yet. Throws [CommentFailure].
  Future<EpisodeComment> post({
    required String episodePublicId,
    required String body,
  });

  /// Takes one of the reader's own comments down. It leaves every list, the
  /// author's own included. Throws [CommentFailure].
  Future<void> withdraw(String commentPublicId);

  /// Flags one other reader's comment as breaking the rules.
  ///
  /// [note] is the reporter's own sentence, optional and blank for none. The
  /// answer says only that the report was accepted: a reader who has already
  /// reported this comment is told exactly what a first reporter is, because
  /// anything else would reveal what the platform has since done about it.
  /// Throws [CommentFailure].
  Future<void> report({
    required String commentPublicId,
    required CommentReportReason reason,
    String note,
  });
}

/// Looks up the [CommentRepository] installed by [CommentScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: the reader is then offered
/// no comments at all.
class CommentScope extends InheritedWidget {
  const CommentScope({super.key, this.repository, required super.child});

  final CommentRepository? repository;

  static CommentRepository? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<CommentScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(CommentScope oldWidget) =>
      repository != oldWidget.repository;
}
