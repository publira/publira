import 'package:flutter/widgets.dart';
import 'package:publira/push/push_controller.dart';

/// Looks up the app's [PushController] and rebuilds its dependents whenever
/// the notification setting changes.
///
/// The controller is absent in a widget test that builds the app without one,
/// and in a build carrying no Firebase project, so [maybeOf] answers `null`
/// rather than asserting: the account screen leaves the switch out then.
class PushScope extends InheritedNotifier<PushController> {
  const PushScope({super.key, PushController? controller, required super.child})
    : super(notifier: controller);

  static PushController? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PushScope>();
    return scope?.notifier;
  }
}
