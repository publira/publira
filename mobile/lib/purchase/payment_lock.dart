import 'package:flutter/foundation.dart';

/// One payment at a time among the ways a screen offers into the same thing:
/// a reader who has chosen one, such as the store's payment sheet, cannot
/// start another, such as paying with coins, until the first has settled.
/// Otherwise both could go through and the reader would pay twice.
///
/// It is taken before the first wait, so a second tap while the first is
/// still asking the server is refused, and the buttons that share it listen
/// to it to stand disabled meanwhile.
class PaymentLock extends ChangeNotifier {
  var _held = false;

  bool get held => _held;

  /// Takes the lock, or answers false when another payment holds it.
  bool acquire() {
    if (_held) {
      return false;
    }
    _held = true;
    notifyListeners();
    return true;
  }

  void release() {
    if (!_held) {
      return;
    }
    _held = false;
    notifyListeners();
  }
}
