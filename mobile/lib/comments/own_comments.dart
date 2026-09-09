import 'package:publira/models/episode_comment.dart';

/// Newest first, the order both lists already arrive in.
///
/// A row whose timestamp the app could not read sorts last rather than
/// silently becoming the epoch, and the public id breaks a tie so the merged
/// order is stable from one load to the next.
int _newestFirst(EpisodeComment left, EpisodeComment right) {
  final leftAt = left.createdAt;
  final rightAt = right.createdAt;
  if (leftAt != null && rightAt != null) {
    final byTime = rightAt.compareTo(leftAt);
    return byTime != 0 ? byTime : right.id.compareTo(left.id);
  }
  if (leftAt != null) {
    return -1;
  }
  if (rightAt != null) {
    return 1;
  }
  return right.id.compareTo(left.id);
}

/// Whether [at] falls inside the stretch of time the public page covers.
///
/// A page's own rows define that stretch: its newest row is the upper bound
/// whenever an earlier page exists, and its oldest row the lower bound
/// whenever a later one does. Either bound is open on the outermost page,
/// which is what puts a brand new comment of the reader's on the first page.
/// Without this the same private row would be repeated on every page, and
/// repetition is exactly the kind of marker a removed comment must not
/// acquire.
bool _withinPage(DateTime at, {DateTime? newest, DateTime? oldest}) {
  if (newest != null && at.isAfter(newest)) {
    return false;
  }
  return !(oldest != null && at.isBefore(oldest));
}

/// Folds the reader's own comments into the public page they belong on, in
/// date order.
///
/// Placing them by date is the whole point: a comment staff removed has to
/// read exactly as it did before, so it cannot be pinned to the top, badged,
/// or moved into a list of its own.
///
/// A page with no public rows takes the own comments only when it is the one
/// and only page. A cursor that lands past the end of the list has no window
/// to place anything in, and showing the reader's own comments there would
/// make that empty page look like a page of theirs.
///
/// A row whose timestamp could not be read has no date to be placed by, and it
/// goes on the oldest page, which is where the order puts an undated row
/// anyway. Measuring it against a window instead would keep it off every page
/// at once, and the reader would lose a comment of their own to a timestamp
/// they never see.
///
/// The two lists are disjoint at the API — the caller's list carries only what
/// the public one omits — but they are read a moment apart, and in the moment
/// between staff removing a published comment and this reader asking for the
/// public page, its author can hold both copies of it. Rendering the row twice
/// is exactly the kind of change a removal is not allowed to make to it, so
/// the public row wins: it is the one the author was already reading.
List<EpisodeComment> mergeOwnComments(
  EpisodeCommentPage page,
  List<EpisodeComment> own,
) {
  if (own.isEmpty) {
    return page.comments;
  }

  final published = page.comments.map((comment) => comment.id).toSet();
  final unpublished = own
      .where((comment) => !published.contains(comment.id))
      .toList();
  if (unpublished.isEmpty) {
    return page.comments;
  }
  if (page.comments.isEmpty) {
    if (page.nextToken.isNotEmpty || page.previousToken.isNotEmpty) {
      return page.comments;
    }
    return unpublished..sort(_newestFirst);
  }

  final newest = page.previousToken.isEmpty
      ? null
      : page.comments.first.createdAt;
  final oldest = page.nextToken.isEmpty ? null : page.comments.last.createdAt;
  final placed = unpublished.where((comment) {
    final at = comment.createdAt;
    return at == null
        ? page.nextToken.isEmpty
        : _withinPage(at, newest: newest, oldest: oldest);
  });
  return [...page.comments, ...placed]..sort(_newestFirst);
}
