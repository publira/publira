import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test/support/pump_until.dart';

/// [WidgetTester.enterText] for a device whose own keyboard is connected to
/// the field.
///
/// [WidgetTester.enterText] reaches the framework alone, so the device keyboard
/// keeps the value the field opened with and can report it back over the
/// typed text. A value the framework sets itself is sent to the keyboard too,
/// and the field has to hold it for a few frames to outlast a report already on
/// its way.
Future<void> typeText(WidgetTester tester, Finder finder, String text) async {
  await tester.showKeyboard(finder);
  final editable = tester.state<EditableTextState>(
    find.descendant(
      of: finder,
      matching: find.byType(EditableText),
      matchRoot: true,
    ),
  );
  final value = TextEditingValue(
    text: text,
    selection: TextSelection.collapsed(offset: text.length),
  );
  var heldFrames = 0;
  await pumpUntilTrue(tester, () {
    if (editable.textEditingValue.text == text) {
      heldFrames++;
      return heldFrames >= 5;
    }
    heldFrames = 0;
    editable.userUpdateTextEditingValue(value, SelectionChangedCause.keyboard);
    return false;
  }, description: '$finder to hold "$text"');
}
