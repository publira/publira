import 'package:flutter/foundation.dart';
import 'package:publira/api/connect_exception.dart';

/// Whether the API is serving the tenant the app was built for.
///
/// A suspended tenant is refused on every request, so no screen of the app
/// has anything to show, and each of them reading the refusal as its own
/// failure would tell the reader to check a connection that is fine. The
/// `ConnectClient` every repository shares reports each answer here instead,
/// and the app shows one screen saying it is unavailable for as long as the
/// API says so.
class TenantAvailability extends ChangeNotifier {
  /// `check` asks the API about the tenant once more, through the same client
  /// that reports its answer here.
  TenantAvailability({required this._check});

  final Future<void> Function() _check;

  bool _suspended = false;
  bool _checking = false;

  /// Whether the last answer the API gave was the refusal of a suspended
  /// tenant.
  bool get suspended => _suspended;

  /// Whether [recheck] is waiting for the API.
  bool get checking => _checking;

  /// The API refused a request because the tenant is suspended.
  void reportSuspended() {
    if (_suspended) {
      return;
    }
    _suspended = true;
    notifyListeners();
  }

  /// The API answered a request, which it does for a tenant it serves.
  void reportServed() {
    if (!_suspended) {
      return;
    }
    _suspended = false;
    notifyListeners();
  }

  /// Asks the API again whether the tenant is served, which is how the app
  /// learns that it has been resumed.
  ///
  /// The answer reaches [suspended] through the client's report, so a lookup
  /// that cannot reach the API leaves the state as it was: the tenant is not
  /// known to be served again.
  Future<void> recheck() async {
    if (_checking) {
      return;
    }
    _checking = true;
    notifyListeners();
    try {
      await _check();
    } on ConnectException {
      // Reported by the client, or not about the tenant at all.
    } finally {
      _checking = false;
      notifyListeners();
    }
  }
}
