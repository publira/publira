import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/models/follow.dart';

/// [FollowRepository] that answers from what a test sets on it.
class FakeFollowRepository implements FollowRepository {
  FakeFollowRepository({
    Set<String>? following,
    this.pages = const [],
    this.statusFailure,
    this.writeFailure,
    this.listFailure,
  }) : following = following ?? <String>{};

  /// What the reader follows, as [targetKey] writes one.
  final Set<String> following;

  /// The pages [listMyFollows] answers, in order. The token of a page is its
  /// own index written out, the way the fixture server writes a cursor.
  List<List<MyFollow>> pages;

  FollowFailure? statusFailure;
  FollowFailure? writeFailure;
  FollowFailure? listFailure;

  /// The targets [follow] and [unfollow] were called with, in order, so a test
  /// can assert what the control sent and not only what it drew.
  final followed = <String>[];
  final unfollowed = <String>[];

  /// How many times a control asked for a state it did not already hold.
  var statusReads = 0;

  static String targetKey(FollowTargetKind kind, String targetId) =>
      '${kind.name}:$targetId';

  @override
  Future<bool> isFollowing(FollowTargetKind kind, String targetId) async {
    statusReads++;
    final failure = statusFailure;
    if (failure != null) {
      throw failure;
    }
    return following.contains(targetKey(kind, targetId));
  }

  @override
  Future<bool> follow(FollowTargetKind kind, String targetId) async {
    followed.add(targetKey(kind, targetId));
    final failure = writeFailure;
    if (failure != null) {
      throw failure;
    }
    following.add(targetKey(kind, targetId));
    return true;
  }

  @override
  Future<bool> unfollow(FollowTargetKind kind, String targetId) async {
    unfollowed.add(targetKey(kind, targetId));
    final failure = writeFailure;
    if (failure != null) {
      throw failure;
    }
    following.remove(targetKey(kind, targetId));
    return false;
  }

  @override
  Future<MyFollowPage> listMyFollows({String token = ''}) async {
    final failure = listFailure;
    if (failure != null) {
      throw failure;
    }
    final index = token.isEmpty ? 0 : int.parse(token);
    if (index >= pages.length) {
      return MyFollowPage.empty;
    }
    return MyFollowPage(
      follows: pages[index],
      nextToken: index + 1 < pages.length ? '${index + 1}' : '',
    );
  }
}
