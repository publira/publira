/// Why a notification reached the reader, one section of the notification
/// preferences.
enum NotificationCategory {
  /// An episode the reader follows, or one of a series they follow.
  followedEpisodes,

  /// An episode credited to an author the reader follows.
  followedCreators,

  /// The reader's own comment approved.
  comments,

  /// An announcement the tenant posted.
  announcements,
}

/// Where a notification reaches the reader.
enum NotificationChannel { inbox, webPush, mobilePush }

/// One switch of the notification preferences: a category on a channel.
typedef NotificationCell = (NotificationCategory, NotificationChannel);

/// Every cell the server delivers, in the order the screen shows them.
///
/// A combination the server does not deliver, such as a push of a comment,
/// has no cell, so no switch stands for something that would never arrive.
const notificationCells = <NotificationCell>[
  (NotificationCategory.followedEpisodes, NotificationChannel.inbox),
  (NotificationCategory.followedEpisodes, NotificationChannel.webPush),
  (NotificationCategory.followedEpisodes, NotificationChannel.mobilePush),
  (NotificationCategory.followedCreators, NotificationChannel.inbox),
  (NotificationCategory.followedCreators, NotificationChannel.webPush),
  (NotificationCategory.followedCreators, NotificationChannel.mobilePush),
  (NotificationCategory.comments, NotificationChannel.inbox),
  (NotificationCategory.announcements, NotificationChannel.inbox),
];

/// The cells of [category], in the order of [NotificationChannel].
List<NotificationCell> cellsOfCategory(NotificationCategory category) => [
  for (final cell in notificationCells)
    if (cell.$1 == category) cell,
];

/// The cells of [channel], in the order of [NotificationCategory].
List<NotificationCell> cellsOfChannel(NotificationChannel channel) => [
  for (final cell in notificationCells)
    if (cell.$2 == channel) cell,
];

/// What the account holds about notifications: whether email goes out, and
/// which cells of [notificationCells] are on.
class NotificationSettings {
  const NotificationSettings({
    required this.emailEnabled,
    required this._preferences,
  });

  final bool emailEnabled;
  final Map<NotificationCell, bool> _preferences;

  /// Whether [cell] is on. A cell the server answered nothing for is on,
  /// since that is how a reader who saved nothing is notified.
  bool isEnabled(NotificationCell cell) => _preferences[cell] ?? true;

  /// Whether every one of [cells] is on (`true`), every one is off (`false`),
  /// or they are mixed (`null`), the three states of a tristate checkbox.
  bool? stateOf(List<NotificationCell> cells) {
    final on = cells.where(isEnabled).length;
    if (on == cells.length) {
      return true;
    }
    return on == 0 ? false : null;
  }

  /// What a tap on the control for [cells] writes: every one of them on,
  /// unless they are all on already, and then every one off.
  Map<NotificationCell, bool> toggle(List<NotificationCell> cells) {
    final enabled = stateOf(cells) != true;
    return {for (final cell in cells) cell: enabled};
  }

  /// These settings with [cells] written over them, and [emailEnabled] in
  /// place of the account's when given.
  NotificationSettings copyWith({
    bool? emailEnabled,
    Map<NotificationCell, bool> cells = const {},
  }) => NotificationSettings(
    emailEnabled: emailEnabled ?? this.emailEnabled,
    preferences: {..._preferences, ...cells},
  );
}
