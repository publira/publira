import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/inbox_notification.dart';
import 'package:publira/notifications/notification_copy.dart';
import 'package:publira/router.dart';

void main() {
  final messages = AppMessages.forLocale(const Locale('en'))!;

  InboxNotification notification(
    InboxNotificationKind kind, [
    String payload = '',
  ]) {
    return InboxNotification(
      id: 'n-1',
      kind: kind,
      payload: InboxNotificationPayload.parse(payload),
    );
  }

  group('the payload', () {
    test('reads every field it knows', () {
      final payload = InboxNotificationPayload.parse(
        '{"series_id":"SeedSERSAAA1","episode_id":"SeedEPSDAAA1",'
        '"series_title":" Seed Series ","episode_title":"Episode 1",'
        '"announcement_title":"Maintenance","hidden_reason":"auto_reports",'
        '"unknown":"ignored"}',
      );

      expect(payload.seriesId, 'SeedSERSAAA1');
      expect(payload.episodeId, 'SeedEPSDAAA1');
      expect(payload.seriesTitle, 'Seed Series');
      expect(payload.episodeTitle, 'Episode 1');
      expect(payload.announcementTitle, 'Maintenance');
      expect(payload.hiddenReason, CommentHiddenReason.autoReports);
    });

    test('drops an id that could reshape a route and keeps the rest', () {
      final payload = InboxNotificationPayload.parse(
        '{"series_id":"../account","episode_id":"SeedEPSDAAA1",'
        '"series_title":"Seed Series"}',
      );

      expect(payload.seriesId, isNull);
      expect(payload.episodeId, 'SeedEPSDAAA1');
      expect(payload.seriesTitle, 'Seed Series');
    });

    for (final raw in ['', 'not json', '[1, 2]', '"text"', '{"series_id":1}']) {
      test('reads "$raw" as naming nothing', () {
        final payload = InboxNotificationPayload.parse(raw);

        expect(payload.seriesId, isNull);
        expect(payload.episodeId, isNull);
        expect(payload.seriesTitle, isNull);
      });
    }
  });

  group('the location', () {
    const both = '{"series_id":"SeedSERSAAA1","episode_id":"SeedEPSDAAA1"}';

    test('opens the episode a new episode notification names', () {
      expect(
        notificationLocation(
          notification(InboxNotificationKind.episodePublished, both),
        ),
        AppRoutes.episodeViewerPath('SeedSERSAAA1', 'SeedEPSDAAA1'),
      );
    });

    test('opens the series when the payload names no episode', () {
      expect(
        notificationLocation(
          notification(
            InboxNotificationKind.episodePublished,
            '{"series_id":"SeedSERSAAA1"}',
          ),
        ),
        AppRoutes.seriesDetailPath('SeedSERSAAA1'),
      );
    });

    test('opens the comments of the episode a comment was on', () {
      for (final kind in [
        InboxNotificationKind.commentApproved,
        InboxNotificationKind.commentHidden,
      ]) {
        expect(
          notificationLocation(notification(kind, both)),
          AppRoutes.episodeCommentsPath('SeedSERSAAA1', 'SeedEPSDAAA1'),
        );
      }
    });

    test('names nothing for a payload the app cannot open', () {
      expect(
        notificationLocation(
          notification(InboxNotificationKind.episodePublished, 'not json'),
        ),
        isNull,
      );
    });

    test('opens the announcements for an announcement', () {
      expect(
        notificationLocation(
          notification(InboxNotificationKind.announcementPosted, both),
        ),
        AppRoutes.announcements,
      );
    });
  });

  group('the copy', () {
    test('names the episode and its series', () {
      final row = notification(
        InboxNotificationKind.episodePublished,
        '{"series_title":"Seed Series","episode_title":"Episode 1"}',
      );

      expect(
        messages.notificationTitle(row),
        'A new episode has been published',
      );
      expect(
        messages.notificationDescription(row),
        '“Episode 1” (Seed Series) is now available.',
      );
    });

    test('says who removed a comment', () {
      final row = notification(
        InboxNotificationKind.commentHidden,
        '{"episode_title":"Episode 1","hidden_reason":"staff"}',
      );

      expect(
        messages.notificationDescription(row),
        'Your comment on “Episode 1” was removed by the operator.',
      );
    });

    test('keeps a type this build does not know as a generic row', () {
      final row = InboxNotification(
        id: 'n-1',
        kind: InboxNotificationKind.fromWire('series_completed'),
      );

      expect(messages.notificationTitle(row), 'Notification');
      expect(messages.notificationDescription(row), 'No further details.');
    });
  });
}
