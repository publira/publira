import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

/// Where the image a reader makes their icon comes from.
abstract class AccountIconPicker {
  /// The bytes of the image [reader] picked, or `null` when they picked
  /// none.
  Future<Uint8List?> pick({required String reader});

  /// The image a pick [reader] started handed over after the platform had
  /// ended the app under the picker, which no [pick] call was left to
  /// receive, or `null` when there is none.
  ///
  /// A kept pick that another reader started is dropped rather than handed
  /// over: the app can open signed in as somebody else, and their photo is
  /// not this reader's icon.
  Future<Uint8List?> recover({required String reader});
}

/// Resolves the directory the reader a pick is open for is written under.
/// Injected so a test can point one at a temporary directory instead of the
/// app's own.
typedef AccountIconPickerRootResolver = Future<Directory> Function();

Future<Directory> _applicationSupportRoot() => getApplicationSupportDirectory();

/// [AccountIconPicker] backed by the `image_picker` plugin's photo library.
///
/// The picker never asks for the photo library permission: with
/// `requestFullMetadata` off, the system picker hands over only the image
/// chosen. `Info.plist` carries `NSPhotoLibraryUsageDescription` all the same,
/// because the App Store asks it of every app that links the picker.
class PluginAccountIconPicker implements AccountIconPicker {
  PluginAccountIconPicker({
    ImagePicker? picker,
    this._root = _applicationSupportRoot,
  }) : _picker = picker ?? ImagePicker();

  /// The file that names the reader a pick is open for, for as long as it is
  /// open. A pick that returns removes it, so one left behind belongs to a
  /// pick the platform ended the app under.
  static const _ownerFileName = 'account-icon-pick-reader';

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
  final AccountIconPickerRootResolver _root;

  /// Android can end the app's activity while the picker is open, and the
  /// plugin then keeps the pick for the next launch. No other platform ends
  /// the app under it, and the plugin implements the lookup only there.
  static bool get _keepsLostPicks =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  @override
  Future<Uint8List?> pick({required String reader}) async {
    final owner = _keepsLostPicks ? await _ownerFile() : null;
    if (owner != null) {
      await owner.parent.create(recursive: true);
      await owner.writeAsString(reader);
    }
    try {
      final file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: _maxDimension,
        maxHeight: _maxDimension,
        imageQuality: 90,
        // Leaves the photo library's permission unasked: the picker hands
        // over only the image the reader chose.
        requestFullMetadata: false,
      );
      return await file?.readAsBytes();
    } finally {
      await _delete(owner);
    }
  }

  @override
  Future<Uint8List?> recover({required String reader}) async {
    if (!_keepsLostPicks) {
      return null;
    }
    // Read first, whoever it belongs to: the plugin hands a kept pick over
    // once, so one that is dropped here is gone for good.
    final lost = await _picker.retrieveLostData();
    final owner = await _ownerFile();
    String? startedBy;
    try {
      startedBy = (await owner.readAsString()).trim();
    } on FileSystemException {
      startedBy = null;
    }
    await _delete(owner);
    final file = lost.file;
    if (file == null || startedBy != reader) {
      return null;
    }
    return file.readAsBytes();
  }

  Future<File> _ownerFile() async {
    final dir = await _root();
    return File('${dir.path}/$_ownerFileName');
  }

  Future<void> _delete(File? file) async {
    try {
      await file?.delete();
    } on FileSystemException {
      // Already gone.
    }
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
