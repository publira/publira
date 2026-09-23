import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Screenshots the reader takes of the app, as the OS reports them after the
/// fact.
abstract class ScreenCaptures {
  /// One event per screenshot. It is a broadcast stream, so a viewer replacing
  /// another can listen before the one it replaces has let go.
  Stream<void> get captures;
}

/// [ScreenCaptures] from the app's own `android/` and `ios/` sources.
///
/// Android reports only from Android 14 on, and older versions stay silent
/// rather than failing.
class PlatformScreenCaptures implements ScreenCaptures {
  const PlatformScreenCaptures();

  static const _channel = EventChannel('dev.publira.app/screen_captures');

  @override
  Stream<void> get captures => _channel.receiveBroadcastStream().map((_) {});
}

/// The screenshots the episode viewer answers with a notice, and the episodes
/// it has already answered for in this run of the app.
class ScreenCaptureNotices {
  ScreenCaptureNotices({required this.captures});

  final ScreenCaptures captures;

  final _noticed = <String>{};

  /// Whether a capture of [episodeId] is the first this run has seen, which
  /// is the one that shows the notice. Asking also records it.
  bool claim(String episodeId) => _noticed.add(episodeId);
}

/// Looks up the [ScreenCaptureNotices] of this run, absent on the web and in a
/// widget test not exercising it.
class ScreenCaptureScope extends InheritedWidget {
  const ScreenCaptureScope({
    super.key,
    required this.notices,
    required super.child,
  });

  final ScreenCaptureNotices? notices;

  static ScreenCaptureNotices? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ScreenCaptureScope>()?.notices;

  @override
  bool updateShouldNotify(ScreenCaptureScope oldWidget) =>
      notices != oldWidget.notices;
}
