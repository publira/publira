import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';

/// Where the image a reader makes their icon comes from.
abstract class AccountIconPicker {
  /// The bytes of the image the reader picked, or `null` when they picked
  /// none.
  Future<Uint8List?> pick();
}

/// [AccountIconPicker] backed by the `image_picker` plugin's photo library.
class PluginAccountIconPicker implements AccountIconPicker {
  PluginAccountIconPicker({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  /// The longest side the picker scales an image down to.
  ///
  /// The API stores at most 512 px of the square it cuts, so a photo straight
  /// off the camera would carry megabytes that never reach the icon, and
  /// could pass the API's 10 MiB limit on its own. A scaled image is
  /// re-encoded too, which on both platforms turns a HEIC into the JPEG the
  /// API takes. At four times the stored side, only an image more than four
  /// times as wide as it is tall loses any of the square the API keeps.
  static const _maxDimension = 2048.0;

  final ImagePicker _picker;

  @override
  Future<Uint8List?> pick() async {
    final file = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: _maxDimension,
      maxHeight: _maxDimension,
      imageQuality: 90,
      // Leaves the photo library's permission unasked: the picker hands over
      // only the image the reader chose.
      requestFullMetadata: false,
    );
    return file?.readAsBytes();
  }
}

/// The [AccountIconPicker] this run can use, absent in a widget test that
/// does not change the icon, which leaves the account screen showing it
/// without the controls that change it.
class AccountIconPickerScope extends InheritedWidget {
  const AccountIconPickerScope({
    super.key,
    required this.picker,
    required super.child,
  });

  final AccountIconPicker? picker;

  static AccountIconPicker? maybeOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<AccountIconPickerScope>()
        ?.picker;
  }

  @override
  bool updateShouldNotify(AccountIconPickerScope oldWidget) {
    return picker != oldWidget.picker;
  }
}
