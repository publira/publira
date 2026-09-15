/// The kinds of public catalog target a reader can follow, as
/// `publira.v1.FollowTargetType` names them.
///
/// The API also takes a follow on a single episode, which nothing in the app
/// offers: an episode follow names something that is already there rather than
/// something that arrives.
enum FollowTargetKind {
  series('FOLLOW_TARGET_TYPE_SERIES'),
  creator('FOLLOW_TARGET_TYPE_CREATOR');

  const FollowTargetKind(this.wireValue);

  /// The enum value the API names this kind by.
  final String wireValue;

  /// The kind [raw] names, or `null` for one this build cannot show: an
  /// episode follow, and whatever a later API adds.
  static FollowTargetKind? fromWire(Object? raw) {
    for (final kind in values) {
      if (kind.wireValue == raw) {
        return kind;
      }
    }
    return null;
  }
}

/// One target the signed-in reader follows, as `publira.v1.MyFollow`
/// describes it.
///
/// The row carries no name: `ListMyFollows` answers with public ids, and what
/// a screen shows beside one is read from the catalog.
class MyFollow {
  const MyFollow({required this.kind, required this.targetId, this.followedAt});

  final FollowTargetKind kind;

  /// Public id of the followed series or creator.
  final String targetId;

  /// When the reader followed it, and `null` when the API sent a timestamp
  /// this build could not read. A row without a date still renders: the target
  /// is what the reader came for.
  final DateTime? followedAt;
}

/// One page of what the reader follows, as `ListMyFollowsResponse` answers it.
///
/// [nextToken] is opaque: the list hands it back unchanged to ask for the page
/// under this one, and an empty one is the end. The response's
/// `previous_token` is left behind, because the list only ever walks forward —
/// what it read stays on screen above what it reads next.
class MyFollowPage {
  const MyFollowPage({required this.follows, this.nextToken = ''});

  /// A reader who follows nothing, which is also what a guest is answered.
  static const empty = MyFollowPage(follows: []);

  final List<MyFollow> follows;

  /// What the API calls the page after this one. Empty at the end of the list.
  final String nextToken;
}
