import 'dart:typed_data';

import 'package:publira/auth/account_icon_picker.dart';

/// [AccountIconPicker] that hands over [picks] in turn, standing in for the
/// photo library.
class FakeAccountIconPicker implements AccountIconPicker {
  FakeAccountIconPicker(this.picks);

  /// What each pick hands over, `null` for one the reader dismissed.
  final List<Uint8List?> picks;

  /// Thrown by [pick] in place of handing anything over.
  Exception? failure;

  var picked = 0;

  @override
  Future<Uint8List?> pick() async {
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
    return picks[picked++];
  }
}
