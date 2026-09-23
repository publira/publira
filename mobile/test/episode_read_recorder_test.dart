import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:publira/viewer/episode_read_recorder.dart';

void main() {
  test('a recorded finish is not sent again', () async {
    var sent = 0;
    final recorder = EpisodeReadRecorder(send: () async => sent++);

    recorder.record();
    await pumpEventQueue();
    recorder.record();
    await pumpEventQueue();

    expect(sent, 1);
  });

  test('an arrival while the finish is in flight sends nothing', () async {
    var sent = 0;
    final answer = Completer<void>();
    final recorder = EpisodeReadRecorder(
      send: () {
        sent++;
        return answer.future;
      },
    );

    recorder
      ..record()
      ..record();
    answer.complete();
    await pumpEventQueue();

    expect(sent, 1);
  });

  test('a failed finish is sent again on the next arrival', () async {
    var sent = 0;
    final recorder = EpisodeReadRecorder(
      send: () async {
        sent++;
        if (sent == 1) {
          throw StateError('offline');
        }
      },
    );

    recorder.record();
    await pumpEventQueue();
    recorder.record();
    await pumpEventQueue();
    recorder.record();
    await pumpEventQueue();

    expect(sent, 2);
  });
}
