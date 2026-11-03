import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/links/share_sheet.dart';
import 'package:share_plus/share_plus.dart';

void main() {
  late Directory cache;

  setUp(() async {
    cache = await Directory.systemTemp.createTemp('share-sheet-test');
    addTearDown(() => cache.delete(recursive: true));
  });

  /// The files under the cache the share sheet writes into.
  List<File> filesInCache() => [
    for (final entry in Directory(
      '${cache.path}/shared-files',
    ).listSync(recursive: true))
      if (entry is File) entry,
  ];

  test('hands the whole download to the sheet as one named file', () async {
    final shared = <ShareParams>[];
    final sheet = PluginShareSheet(
      cache: () async => cache,
      present: (params) async => shared.add(params),
    );

    await sheet.shareFileStream(
      bytes: Stream.fromIterable([
        [1, 2],
        [3],
      ]),
      name: 'data-export.zip',
      mimeType: 'application/zip',
      title: 'Download your data',
    );

    final file = shared.single.files!.single;
    expect(file.name, 'data-export.zip');
    expect(file.mimeType, 'application/zip');
    expect(await file.readAsBytes(), [1, 2, 3]);
    expect(shared.single.title, 'Download your data');
  });

  test('a download that fails opens no sheet and leaves no file', () async {
    final shared = <ShareParams>[];
    final sheet = PluginShareSheet(
      cache: () async => cache,
      present: (params) async => shared.add(params),
    );

    await expectLater(
      sheet.shareFileStream(
        bytes: Stream.fromIterable([
          [1],
        ]).followedBy(Stream.error(StateError('cut off'))),
        name: 'data-export.zip',
        mimeType: 'application/zip',
        title: 'Download your data',
      ),
      throwsStateError,
    );

    expect(shared, isEmpty);
    expect(filesInCache(), isEmpty);
  });

  test(
    'a download started while another is under way leaves it alone',
    () async {
      final shared = <ShareParams>[];
      final firstPieces = StreamController<List<int>>();
      final sheet = PluginShareSheet(
        cache: () async => cache,
        present: (params) async => shared.add(params),
      );

      final first = sheet.shareFileStream(
        bytes: firstPieces.stream,
        name: 'data-export.zip',
        mimeType: 'application/zip',
        title: 'Download your data',
      );
      firstPieces.add([1, 1]);
      await pumpEventQueue();
      await sheet.shareFileStream(
        bytes: Stream.value([2, 2, 2]),
        name: 'data-export.zip',
        mimeType: 'application/zip',
        title: 'Download your data',
      );
      firstPieces.add([1]);
      await firstPieces.close();
      await first;

      expect(
        [for (final params in shared) await params.files!.single.readAsBytes()],
        [
          [2, 2, 2],
          [1, 1, 1],
        ],
      );
    },
  );

  test('only the file shared last is kept once nothing is under way', () async {
    final sheet = PluginShareSheet(
      cache: () async => cache,
      present: (_) async {},
    );
    for (final piece in [
      [1],
      [2],
    ]) {
      await sheet.shareFileStream(
        bytes: Stream.value(piece),
        name: 'data-export.zip',
        mimeType: 'application/zip',
        title: 'Download your data',
      );
    }

    expect(
      [for (final file in filesInCache()) file.readAsBytesSync()],
      [
        [2],
      ],
    );
  });
}

extension<T> on Stream<T> {
  /// This stream, then [next].
  Stream<T> followedBy(Stream<T> next) async* {
    yield* this;
    yield* next;
  }
}
