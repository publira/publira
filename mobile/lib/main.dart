import 'package:flutter/material.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:publira/app.dart';
import 'package:publira/config.dart';
import 'package:publira/purchase/store_purchaser.dart';
import 'package:publira/push/firebase_push_messaging.dart';

Future<void> main() async {
  // Initializing Firebase is a platform call, so the binding has to exist
  // first and the first frame waits for it. A build with no Firebase project,
  // and a device Firebase cannot start on, answer with no messaging service
  // and the app runs with notifications off.
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  final messaging = await FirebasePushMessaging.connect(config.firebase);
  runApp(
    PubliraApp.fromConfig(
      config: config,
      messaging: messaging,
      // Registered before `main` on the platforms that have a store.
      inAppPurchase: deviceInAppPurchaseStore() == null
          ? null
          : InAppPurchasePlatform.instance,
    ),
  );
}
