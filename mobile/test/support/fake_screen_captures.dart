import 'dart:async';

import 'package:publira/viewer/screen_captures.dart';

/// [ScreenCaptures] a test takes screenshots with by calling [capture].
///
/// A capture reaches the listeners before [capture] returns, so the next
/// pump draws what it caused.
class FakeScreenCaptures implements ScreenCaptures {
  final _controller = StreamController<void>.broadcast(sync: true);

  @override
  Stream<void> get captures => _controller.stream;

  /// Whether anything is listening, which is what the platform side keys its
  /// own registration on.
  bool get hasListener => _controller.hasListener;

  void capture() => _controller.add(null);
}
