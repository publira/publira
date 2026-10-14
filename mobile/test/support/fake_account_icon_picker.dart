import 'dart:async';
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

  /// The reader each [pick] and [recover] was asked for, in order.
  final pickedFor = <String>[];
  final recoveredFor = <String>[];

  /// What [recover] hands over once, standing in for a pick Android kept
  /// after ending the app under the picker.
  Uint8List? lost;

  /// Held open by a test that needs to act while [recover] is in flight.
  Completer<void>? recoverGate;

  @override
  Future<Uint8List?> pick({required String reader}) async {
    pickedFor.add(reader);
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
    return picks[picked++];
  }

  @override
  Future<Uint8List?> recover({required String reader}) async {
    recoveredFor.add(reader);
    await recoverGate?.future;
    final lost = this.lost;
    this.lost = null;
    return lost;
  }
}
