import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:publira/auth/account_icon_picker.dart';

import 'support/icon_images.dart';

/// The photo library as the plugin's platform side answers it: [picked] for a
/// pick, and [lost] once for the pick Android kept after ending the app.
class _FakeImagePickerPlatform extends ImagePickerPlatform {
  Uint8List? picked;
  Completer<void>? pickGate;
  LostDataResponse lost = LostDataResponse.empty();
  var lostReads = 0;

  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async {
    await pickGate?.future;
    final bytes = picked;
    return bytes == null ? null : XFile.fromData(bytes);
  }

  @override
  Future<LostDataResponse> getLostData() async {
    lostReads++;
    final kept = lost;
    lost = LostDataResponse.empty();
    return kept;
  }
}

void main() {
  late Directory root;
  late _FakeImagePickerPlatform platform;
  late ImagePickerPlatform original;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('account-icon-picker');
    original = ImagePickerPlatform.instance;
    platform = ImagePickerPlatform.instance = _FakeImagePickerPlatform();
  });

  tearDown(() async {
    ImagePickerPlatform.instance = original;
    debugDefaultTargetPlatformOverride = null;
    await root.delete(recursive: true);
  });

  /// A launch of the app: every one starts with a picker of its own.
  PluginAccountIconPicker launch() =>
      PluginAccountIconPicker(root: () async => root);

  File ownerFile() => File('${root.path}/account-icon-pick-reader');

  LostDataResponse kept(Uint8List bytes) =>
      LostDataResponse(file: XFile.fromData(bytes), type: RetrieveType.image);

  test('a pick that returns hands over its image and names nobody', () async {
    final image = pngIcon();
    platform.picked = image;

    expect(await launch().pick(reader: 'ReaderAAAAA1'), image);
    expect(ownerFile().existsSync(), isFalse);
  });

  test('a pick the app was ended under is recovered for the reader who '
      'started it', () async {
    final image = pngIcon();
    platform.pickGate = Completer<void>();
    unawaited(launch().pick(reader: 'ReaderAAAAA1'));
    await pumpEventQueue();
    expect(ownerFile().readAsStringSync(), 'ReaderAAAAA1');

    // The app is ended with the picker still open, and launched again.
    platform.lost = kept(image);
    expect(await launch().recover(reader: 'ReaderAAAAA1'), image);
    expect(ownerFile().existsSync(), isFalse);
  });

  test('a kept pick another reader started is dropped for good', () async {
    ownerFile().writeAsStringSync('ReaderAAAAA1');
    platform.lost = kept(pngIcon());

    expect(await launch().recover(reader: 'ReaderBBBBB2'), isNull);
    expect(platform.lostReads, 1);
    expect(ownerFile().existsSync(), isFalse);
    expect(await launch().recover(reader: 'ReaderAAAAA1'), isNull);
  });

  test('a kept pick nobody is recorded for is dropped', () async {
    platform.lost = kept(pngIcon());

    expect(await launch().recover(reader: 'ReaderAAAAA1'), isNull);
    expect(platform.lostReads, 1);
  });

  test('only Android is asked for a kept pick or told who picks', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    platform.picked = pngIcon();
    platform.lost = kept(pngIcon());

    await launch().pick(reader: 'ReaderAAAAA1');
    expect(await launch().recover(reader: 'ReaderAAAAA1'), isNull);
    expect(platform.lostReads, 0);
    expect(ownerFile().existsSync(), isFalse);
  });
}
