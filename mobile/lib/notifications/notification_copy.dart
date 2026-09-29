import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/router.dart';

/// What an inbox row says, assembled from the notification's type and payload
/// the way the site's inbox assembles it: the API stores neither a title nor a
/// body.
extension InboxNotificationCopy on AppMessages {
  String notificationTitle(InboxNotification notification) {
    return switch (notification.kind) {
      InboxNotificationKind.episodePublished =>
        notificationsEpisodePublishedTitle,
      InboxNotificationKind.commentApproved =>
        notificationsCommentApprovedTitle,
      InboxNotificationKind.commentHidden => notificationsCommentHiddenTitle,
      InboxNotificationKind.announcementPosted =>
        notificationsAnnouncementPostedTitle,
      InboxNotificationKind.unknown => notificationsUnknownTitle,
    };
  }

  String notificationDescription(InboxNotification notification) {
    final payload = notification.payload;
    switch (notification.kind) {
      case InboxNotificationKind.episodePublished:
        return notificationsEpisodePublishedDescription(
          subject:
              _episodeSubject(payload) ??
              notificationsEpisodePublishedSubjectUnknown,
        );
      case InboxNotificationKind.commentApproved:
        return notificationsCommentApprovedDescription(
          subject:
              _episodeSubject(payload) ?? notificationsCommentSubjectUnknown,
        );
      case InboxNotificationKind.commentHidden:
        final subject =
            _episodeSubject(payload) ?? notificationsCommentSubjectUnknown;
        return switch (payload.hiddenReason) {
          CommentHiddenReason.staff =>
            notificationsCommentHiddenDescriptionStaff(subject: subject),
          CommentHiddenReason.autoReports =>
            notificationsCommentHiddenDescriptionReports(subject: subject),
          null => notificationsCommentHiddenDescription(subject: subject),
        };
      case InboxNotificationKind.announcementPosted:
        final title = payload.announcementTitle;
        return title == null
            ? notificationsAnnouncementPostedDescriptionUnknown
            : notificationsAnnouncementPostedDescription(title: title);
      case InboxNotificationKind.unknown:
        return notificationsUnknownDescription;
    }
  }

  /// The episode a notification is about, or `null` when the payload names
  /// neither title. Quoting and the order of the two titles differ per
  /// language, so each shape is a message of its own.
  String? _episodeSubject(InboxNotificationPayload payload) {
    final episodeTitle = payload.episodeTitle;
    final seriesTitle = payload.seriesTitle;
    if (episodeTitle != null && seriesTitle != null) {
      return notificationsEpisodeSubjectWithSeries(
        episodeTitle: episodeTitle,
        seriesTitle: seriesTitle,
      );
    }
    if (episodeTitle != null) {
      return notificationsEpisodeSubject(episodeTitle: episodeTitle);
    }
    if (seriesTitle != null) {
      return notificationsEpisodeSubjectSeries(seriesTitle: seriesTitle);
    }
    return null;
  }
}

/// The in-app location [notification] is about, or `null` when it names none
/// the app can open, which the inbox answers with the catalog.
///
/// A comment notification opens the comments of its episode, which the app
/// has a route for where the site does not. An announcement's payload names no
/// announcement, so it opens the list the announcement is in.
String? notificationLocation(InboxNotification notification) {
  final payload = notification.payload;
  final seriesId = payload.seriesId;
  final episodeId = payload.episodeId;
  switch (notification.kind) {
    case InboxNotificationKind.announcementPosted:
      return AppRoutes.announcements;
    case InboxNotificationKind.commentApproved ||
            InboxNotificationKind.commentHidden
        when seriesId != null && episodeId != null:
      return AppRoutes.episodeCommentsPath(seriesId, episodeId);
    case _ when seriesId != null && episodeId != null:
      return AppRoutes.episodeViewerPath(seriesId, episodeId);
    case _ when seriesId != null:
      return AppRoutes.seriesDetailPath(seriesId);
    case _:
      return null;
  }
}
