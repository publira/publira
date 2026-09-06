import 'package:flutter/material.dart';
import 'package:publira/app.dart';
import 'package:publira/config.dart';
import 'package:publira/push/firebase_push_messaging.dart';

Future<void> main() async {
  // Initializing Firebase is a platform call, so the binding has to exist
  // first and the first frame waits for it. A build with no Firebase project,
  // and a device Firebase cannot start on, answer with no messaging service
  // and the app runs with notifications off.
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  final messaging = await FirebasePushMessaging.connect(config.firebase);
  runApp(PubliraApp.fromConfig(config: config, messaging: messaging));
}
