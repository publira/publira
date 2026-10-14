import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';

/// Where the image a reader makes their icon comes from.
abstract class AccountIconPicker {
  /// The bytes of the image the reader picked, or `null` when they picked
  /// none.
  Future<Uint8List?> pick();

  /// The image a pick handed over after the platform had ended the app under
  /// the picker, which no [pick] call was left to receive, or `null` when
  /// there is none.
  Future<Uint8List?> recover();
}

/// [AccountIconPicker] backed by the `image_picker` plugin's photo library.
///
/// The picker never asks for the photo library permission: with
/// `requestFullMetadata` off, the system picker hands over only the image
/// chosen. `Info.plist` carries `NSPhotoLibraryUsageDescription` all the same,
/// because the App Store asks it of every app that links the picker.
class PluginAccountIconPicker implements AccountIconPicker {
  PluginAccountIconPicker({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  /// The longest side the picker scales an image down to.
  ///
  /// The API stores at most 512 px of the square it cuts, and a photo from a
  /// 24 or 48 megapixel camera, re-encoded the way the picker always does on
  /// iOS, can pass the API's 10 MiB limit on its own. A scaled image is
  /// re-encoded too, which on both platforms turns a HEIC into the JPEG the
  /// API takes.
  ///
  /// Scaling bounds the longer side, so it shortens the shorter one with it,
  /// and the image_picker API has no bound for the shorter side alone. At
  /// 4096 px only an image more than 32 times as wide as it is tall can come
  /// out under the 128 px the API takes when it would have taken the
  /// original.
  static const _maxDimension = 4096.0;

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

  /// Android can end the app's activity while the picker is open, and the
  /// plugin then keeps the pick for the next launch. No other platform ends
  /// the app under it, and the plugin implements the lookup only there.
  @override
  Future<Uint8List?> recover() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return null;
    }
    final lost = await _picker.retrieveLostData();
    return lost.file?.readAsBytes();
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
