import 'package:flutter/widgets.dart';
import 'package:publira/offline/episode_downloader.dart';
import 'package:publira/offline/offline_library.dart';

/// Looks up what the device holds for reading without a network.
///
/// Unlike the catalog and the session, this one is allowed to be absent: a
/// build or a platform with nowhere to save reads online only, and a screen
/// that finds nothing here simply does not offer the offline affordances.
class OfflineScope extends InheritedWidget {
  const OfflineScope({
    super.key,
    required this.library,
    this.downloader,
    required super.child,
  });

  final OfflineLibrary? library;

  /// Saves a whole episode when the reader asks for it. `null` wherever
  /// [library] is, and in a widget test not exercising it.
  final EpisodeDownloader? downloader;

  /// The device's library, or `null` when this run has none.
  static OfflineLibrary? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OfflineScope>()?.library;

  /// What saves an episode for offline reading, or `null` when this run
  /// offers none.
  static EpisodeDownloader? downloaderOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OfflineScope>()?.downloader;

  @override
  bool updateShouldNotify(OfflineScope oldWidget) =>
      library != oldWidget.library || downloader != oldWidget.downloader;
}
