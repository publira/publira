import 'package:flutter/widgets.dart';
import 'package:publira/auth/auth_controller.dart';

/// Looks up the app's [AuthController] and rebuilds its dependents whenever
/// the signed-in reader changes.
class AuthScope extends InheritedNotifier<AuthController> {
  const AuthScope({
    super.key,
    required AuthController controller,
    required super.child,
  }) : super(notifier: controller);

  static AuthController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AuthScope>();
    assert(scope != null, 'AuthScope not found');
    return scope!.notifier!;
  }
}
