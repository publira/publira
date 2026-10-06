import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/l10n/gen/app_messages.dart';

void main() {
  group('a count picks the variant of the catalog locale', () {
    final en = AppMessages.forLocale(const Locale('en'))!;

    test('the episodes of a series', () {
      expect(en.seriesEpisodeCount(count: 1), '1 episode');
      expect(en.seriesEpisodeCount(count: 1200), '1,200 episodes');
    });

    test('the readers behind a rating', () {
      expect(
        en.seriesRating(average: '4.0', count: 1),
        'Rating: 4.0 · 1 reader',
      );
      expect(
        en.seriesRating(average: '3.5', count: 12),
        'Rating: 3.5 · 12 readers',
      );
    });

    test('the readers who reacted to an episode', () {
      expect(en.viewerReactionCount(count: 1), '1 reader reacted');
      expect(en.viewerReactionCount(count: 12), '12 readers reacted');
    });

    test('the pages of a partly saved episode', () {
      expect(
        en.downloadsPartial(saved: 0, total: 1),
        startsWith('Partly saved: 0 of 1 page. '),
      );
      expect(
        en.downloadsPartial(saved: 3, total: 12),
        startsWith('Partly saved: 3 of 12 pages. '),
      );
    });

    test('a locale with no plural categories writes one form', () {
      final ja = AppMessages.forLocale(const Locale('ja'))!;
      expect(ja.seriesEpisodeCount(count: 1), '1話');
      expect(ja.seriesEpisodeCount(count: 1200), '1,200話');
    });
  });
}
