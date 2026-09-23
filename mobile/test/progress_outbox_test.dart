import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/catalog/catalog_failure.dart';
import 'package:publira/offline/offline_catalog_repository.dart';
import 'package:publira/offline/offline_library.dart';

import 'support/fake_catalog_repository.dart';
import 'support/fake_offline_library.dart';

const _seriesId = 'SeedSERSAAA1';
const _episodeId = 'SeedEPSDAAA1';
const _reader = 'SeedMMBRAAA1';
const _otherReader = 'SeedMMBRAAA2';

const _network = CatalogFailure(CatalogFailureKind.network);
const _unexpected = CatalogFailure(CatalogFailureKind.unexpected);
const _sessionExpired = CatalogFailure(CatalogFailureKind.sessionExpired);

/// [FakeCatalogRepository] whose position sends can be held open, so a test
/// can queue a page while one is on its way.
class _GatedCatalog extends FakeCatalogRepository {
  Completer<void>? positionGate;

  @override
  Future<void> saveReadingPosition(
    String seriesPublicId,
    String episodePublicId,
    int pageIndex,
  ) async {
    final gate = positionGate;
    if (gate != null) {
      await gate.future;
    }
    return super.saveReadingPosition(
      seriesPublicId,
      episodePublicId,
      pageIndex,
    );
  }
}

void main() {
  group('unsent progress', () {
    const queued = UnsentProgress(
      readerId: _reader,
      episodeId: _episodeId,
      seriesId: _seriesId,
      pageIndex: 2,
    );

    test('a later page replaces the queued one, and a finish stays', () {
      final merged = queued
          .mergedWith(
            const UnsentProgress(
              readerId: _reader,
              episodeId: _episodeId,
              finished: true,
            ),
          )
          .mergedWith(
            const UnsentProgress(
              readerId: _reader,
              episodeId: _episodeId,
              seriesId: _seriesId,
              pageIndex: 5,
            ),
          );

      expect(merged.pageIndex, 5);
      expect(merged.seriesId, _seriesId);
      expect(merged.finished, isTrue);
    });

    test('a page sent before a newer one was queued leaves the newer one', () {
      final left = queued
          .mergedWith(
            const UnsentProgress(
              readerId: _reader,
              episodeId: _episodeId,
              seriesId: _seriesId,
              pageIndex: 4,
            ),
          )
          .settledBy(queued);

      expect(left.pageIndex, 4);
      expect(left.isEmpty, isFalse);
    });

    test('the newest page sent drops whichever page is queued', () {
      final left = queued.settledBy(
        const UnsentProgress(
          readerId: _reader,
          episodeId: _episodeId,
          seriesId: _seriesId,
          pageIndex: 7,
        ),
        newest: true,
      );

      expect(left.isEmpty, isTrue);
    });
  });

  group('the outbox', () {
    late _GatedCatalog origin;
    late InMemoryOfflineLibrary library;
    late String readerId;

    setUp(() {
      origin = _GatedCatalog();
      library = InMemoryOfflineLibrary();
      readerId = _reader;
    });

    OfflineCatalogRepository build() {
      return OfflineCatalogRepository(
        origin: origin,
        library: library,
        readerId: () => readerId,
        imageRequestHeaders: const {},
      );
    }

    test('a finish made with the API gone is kept, not reported', () async {
      origin.markReadError = _network;

      await build().markEpisodeAsRead(_episodeId);

      expect(await library.readUnsentProgress(readerId: _reader), [
        isA<UnsentProgress>()
            .having((p) => p.episodeId, 'episodeId', _episodeId)
            .having((p) => p.finished, 'finished', isTrue),
      ]);
    });

    test('a finish is sent once the API is back, then dropped', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      origin.markReadError = null;
      await catalog.outbox.flush();

      expect(origin.markedRead, [_episodeId, _episodeId]);
      expect(await library.readUnsentProgress(readerId: _reader), isEmpty);
    });

    test('only the last page turned to with the API gone is sent', () async {
      final catalog = build();
      origin.readingPositionError = _network;
      await catalog.saveReadingPosition(_seriesId, _episodeId, 1);
      await catalog.saveReadingPosition(_seriesId, _episodeId, 2);

      origin.readingPositionError = null;
      await catalog.outbox.flush();

      expect(origin.readingPositions, {episodeKey(_seriesId, _episodeId): 2});
      expect(await library.readUnsentProgress(readerId: _reader), isEmpty);
    });

    test('a read the API answers sends what was queued', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      origin.markReadError = null;
      await catalog.listSeries();
      await pumpEventQueue();

      expect(origin.markedRead, [_episodeId, _episodeId]);
    });

    test('a flush that cannot reach the API keeps the queue', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      await catalog.outbox.flush();

      expect(await library.readUnsentProgress(readerId: _reader), hasLength(1));
    });

    test('a session the API refused keeps the queue', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      origin.markReadError = _sessionExpired;
      await catalog.outbox.flush();

      expect(await library.readUnsentProgress(readerId: _reader), hasLength(1));
    });

    test('a send the API turns down is dropped', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      origin.markReadError = _unexpected;
      await catalog.outbox.flush();

      expect(await library.readUnsentProgress(readerId: _reader), isEmpty);
    });

    test('a page recorded online drops an older one still queued', () async {
      final catalog = build();
      origin.readingPositionError = _network;
      await catalog.saveReadingPosition(_seriesId, _episodeId, 1);

      origin.readingPositionError = null;
      await catalog.saveReadingPosition(_seriesId, _episodeId, 3);
      await catalog.outbox.flush();

      expect(origin.readingPositions, {episodeKey(_seriesId, _episodeId): 3});
    });

    test(
      'a page queued while an older one is on its way is sent next',
      () async {
        final catalog = build();
        origin.readingPositionError = _network;
        await catalog.saveReadingPosition(_seriesId, _episodeId, 1);
        origin.readingPositionError = null;

        final gate = origin.positionGate = Completer<void>();
        final flushed = catalog.outbox.flush();
        await pumpEventQueue();
        await library.queueUnsentProgress(
          const UnsentProgress(
            readerId: _reader,
            episodeId: _episodeId,
            seriesId: _seriesId,
            pageIndex: 2,
          ),
        );
        origin.positionGate = null;
        gate.complete();
        await flushed;
        await catalog.outbox.flush();

        expect(origin.readingPositions, {episodeKey(_seriesId, _episodeId): 2});
        expect(await library.readUnsentProgress(readerId: _reader), isEmpty);
      },
    );

    test("another reader's queue is never sent under this session", () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);

      origin.markReadError = null;
      readerId = _otherReader;
      await catalog.outbox.flush();
      readerId = '';
      await catalog.outbox.flush();

      expect(origin.markedRead, [_episodeId]);
      expect(await library.readUnsentProgress(readerId: _reader), hasLength(1));
    });

    test('signing out drops only that reader\'s queue', () async {
      final catalog = build();
      origin.markReadError = _network;
      await catalog.markEpisodeAsRead(_episodeId);
      readerId = _otherReader;
      await catalog.markEpisodeAsRead(_episodeId);

      await catalog.outbox.forget(_reader);

      expect(await library.readUnsentProgress(readerId: _reader), isEmpty);
      expect(
        await library.readUnsentProgress(readerId: _otherReader),
        hasLength(1),
      );
    });

    test('a guest queues nothing', () async {
      readerId = '';
      origin.markReadError = _network;

      await expectLater(
        build().markEpisodeAsRead(_episodeId),
        throwsA(isA<CatalogFailure>()),
      );
      expect(library.unsent, isEmpty);
    });
  });
}
