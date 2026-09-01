import 'package:flutter/widgets.dart';
import 'package:publira/offline/offline_library.dart';

/// Looks up what the device holds for reading without a network.
///
/// Unlike the catalog and the session, this one is allowed to be absent: a
/// build or a platform with nowhere to save reads online only, and a screen
/// that finds nothing here simply does not offer the offline affordances.
class OfflineScope extends InheritedWidget {
  const OfflineScope({super.key, required this.library, required super.child});

  final OfflineLibrary? library;

  /// The device's library, or `null` when this run has none.
  static OfflineLibrary? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OfflineScope>()?.library;

  @override
  bool updateShouldNotify(OfflineScope oldWidget) =>
      library != oldWidget.library;
}
