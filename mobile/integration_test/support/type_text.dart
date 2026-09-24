import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// [WidgetTester.enterText] for a device whose own keyboard is connected to
/// the field.
///
/// [WidgetTester.enterText] reaches the framework alone, so the device keyboard
/// keeps the value the field opened with and can report it back over the
/// typed text. This sets the value from the framework side, which sends it to
/// the device as well, and returns once the device has answered for it with
/// the field still holding the text.
Future<void> typeText(
  WidgetTester tester,
  Finder finder,
  String text, {
  Duration timeout = const Duration(seconds: 10),
}) async {
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
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (editable.textEditingValue.text != text) {
      editable.userUpdateTextEditingValue(
        value,
        SelectionChangedCause.keyboard,
      );
    }
    // The device answers the channel in order, so once this returns every
    // report it sent before taking the value has reached the field.
    await SystemChannels.textInput.invokeMethod<void>(
      'TextInput.setEditingState',
      editable.textEditingValue.toJSON(),
    );
    await tester.pump();
    if (editable.textEditingValue.text == text) {
      return;
    }
  }
  fail('Timed out waiting for $finder to hold "$text"');
}
