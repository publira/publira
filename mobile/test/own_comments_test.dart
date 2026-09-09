import 'package:flutter_test/flutter_test.dart';
import 'package:publira/comments/own_comments.dart';
import 'package:publira/models/episode_comment.dart';

void main() {
  EpisodeComment comment(
    String id, {
    DateTime? at,
    bool awaitingApproval = false,
  }) {
    return EpisodeComment(
      id: id,
      body: 'body of $id',
      createdAt: at,
      awaitingApproval: awaitingApproval,
    );
  }

  List<String> idsOf(List<EpisodeComment> comments) => [
    for (final comment in comments) comment.id,
  ];

  test('a page nobody has a private row on is the page itself', () {
    final page = EpisodeCommentPage(
      comments: [comment('public-1', at: DateTime.utc(2026, 9, 8))],
    );

    expect(idsOf(mergeOwnComments(page, const [])), ['public-1']);
  });

  test('a comment the public page already carries is not repeated', () {
    final page = EpisodeCommentPage(
      comments: [comment('mine', at: DateTime.utc(2026, 9, 8))],
    );

    // Staff removing a published comment leaves its author holding both
    // copies of it for as long as the two reads disagree, and a row rendered
    // twice is exactly the change a silent removal may not make to it.
    final merged = mergeOwnComments(page, [
      comment('mine', at: DateTime.utc(2026, 9, 8)),
    ]);

    expect(idsOf(merged), ['mine']);
  });

  test('the only page takes the reader own comments in date order', () {
    final page = EpisodeCommentPage(
      comments: [
        comment('public-newer', at: DateTime.utc(2026, 9, 8, 12)),
        comment('public-older', at: DateTime.utc(2026, 9, 8, 8)),
      ],
    );

    final merged = mergeOwnComments(page, [
      comment('mine', at: DateTime.utc(2026, 9, 8, 10), awaitingApproval: true),
    ]);

    expect(idsOf(merged), ['public-newer', 'mine', 'public-older']);
  });

  test('an empty single page shows the reader their own comments', () {
    final merged = mergeOwnComments(const EpisodeCommentPage(), [
      comment('older', at: DateTime.utc(2026, 9, 8, 8)),
      comment('newer', at: DateTime.utc(2026, 9, 8, 12)),
    ]);

    expect(idsOf(merged), ['newer', 'older']);
  });

  test('a page in the middle takes only what falls inside its window', () {
    final page = EpisodeCommentPage(
      comments: [
        comment('public-newer', at: DateTime.utc(2026, 9, 8, 12)),
        comment('public-older', at: DateTime.utc(2026, 9, 8, 8)),
      ],
      previousToken: 'newer-page',
      nextToken: 'older-page',
    );

    final merged = mergeOwnComments(page, [
      comment('too-new', at: DateTime.utc(2026, 9, 8, 23)),
      comment('inside', at: DateTime.utc(2026, 9, 8, 10)),
      comment('too-old', at: DateTime.utc(2026, 9, 8, 1)),
    ]);

    expect(idsOf(merged), ['public-newer', 'inside', 'public-older']);
  });

  test('an empty page past the end of the list takes none', () {
    // A cursor that lands past the last comment has no window to place
    // anything in, and the reader's own rows there would make an empty page
    // look like a page of theirs.
    final merged = mergeOwnComments(
      const EpisodeCommentPage(previousToken: 'newer-page'),
      [comment('mine', at: DateTime.utc(2026, 9, 8))],
    );

    expect(merged, isEmpty);
  });

  test('a row whose timestamp could not be read sorts last', () {
    final merged = mergeOwnComments(const EpisodeCommentPage(), [
      comment('undated'),
      comment('dated', at: DateTime.utc(2026, 9, 8)),
    ]);

    expect(idsOf(merged), ['dated', 'undated']);
  });
}
