import 'package:flutter/widgets.dart';
import 'package:publira/models/follow.dart';

/// The reader's half of `publira.v1.FollowService`.
///
/// Every call reaches the API. What a reader follows is one list held for
/// them across their devices and the site, so a device that answered it on its
/// own would show a state the next screen contradicts.
abstract class FollowRepository {
  /// Whether the signed-in reader follows [targetId].
  ///
  /// A reader who is signed out follows nothing, so this answers `false`
  /// without a request. Throws [FollowFailure].
  Future<bool> isFollowing(FollowTargetKind kind, String targetId);

  /// Follows [targetId] as the signed-in reader, and answers with the state
  /// the API stored. Following twice is the same as following once.
  ///
  /// Throws [FollowFailure].
  Future<bool> follow(FollowTargetKind kind, String targetId);

  /// Stops following [targetId], and answers with the state the API stored.
  /// Unfollowing something unfollowed is the same as unfollowing it once.
  ///
  /// Throws [FollowFailure].
  Future<bool> unfollow(FollowTargetKind kind, String targetId);

  /// One page of what the signed-in reader follows, newest follow first.
  ///
  /// [token] is the opaque cursor from a previous page, empty for the first
  /// one. The API answers only with targets that are still public, so a series
  /// taken down leaves the list rather than arriving as a row nothing names. A
  /// reader who is signed out follows nothing. Throws [FollowFailure].
  Future<MyFollowPage> listMyFollows({String token});
}

/// Looks up the [FollowRepository] installed by [FollowScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no screen then offers to
/// follow anything.
class FollowScope extends InheritedWidget {
  const FollowScope({super.key, this.repository, required super.child});

  final FollowRepository? repository;

  static FollowRepository? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<FollowScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(FollowScope oldWidget) =>
      repository != oldWidget.repository;
}
