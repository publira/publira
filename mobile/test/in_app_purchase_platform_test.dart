import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:publira/purchase/store_purchaser.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('registers Google Play on Android before main reads the instance', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    // Google Play's billing client connects as soon as it is created. On a
    // device the plugin answers; here the connection is left waiting, since
    // an unanswered channel would fail the test after it has finished.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler(
          'dev.flutter.pigeon.in_app_purchase_android.InAppPurchaseApi.startConnection',
          (_) => Completer<ByteData?>().future,
        );

    final platform = registerDeviceInAppPurchasePlatform();

    expect(platform, isA<InAppPurchaseAndroidPlatform>());
    expect(InAppPurchasePlatform.instance, same(platform));
  });

  test('registers StoreKit on iOS before main reads the instance', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;

    final platform = registerDeviceInAppPurchasePlatform();

    expect(platform, isA<InAppPurchaseStoreKitPlatform>());
    expect(InAppPurchasePlatform.instance, same(platform));
  });

  test('registers nothing on a platform with no store', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;

    expect(registerDeviceInAppPurchasePlatform(), isNull);
  });
}
