import 'dart:async';

import 'package:publira/links/external_browser.dart';
import 'package:publira/links/incoming_links.dart';
import 'package:publira/links/share_sheet.dart';

/// Incoming URLs a test writes, so routing can be driven without the OS.
class FakeIncomingLinks implements IncomingLinks {
  FakeIncomingLinks({this.initialUri, this.initialError});

  /// The URL that opened a terminated app, which [initial] reports once.
  Uri? initialUri;
  Object? initialError;

  final controller = StreamController<Uri>.broadcast();

  Future<void> close() async {
    await controller.close();
  }

  @override
  Future<Uri?> get initial async {
    if (initialError case final error?) {
      throw error;
    }
    return initialUri;
  }

  @override
  Stream<Uri> get changes => controller.stream;

  void deliver(Uri uri) => controller.add(uri);
}

/// A share sheet a test reads, so the action can be asserted without opening
/// the platform dialog.
class FakeShareSheet implements ShareSheet {
  Uri? url;
  String? title;
  String? text;
  var calls = 0;

  @override
  Future<void> share({
    required Uri url,
    required String title,
    required String text,
  }) async {
    calls++;
    this.url = url;
    this.title = title;
    this.text = text;
  }
}

/// A browser a test reads, so a link handed off can be asserted without
/// leaving the app.
class FakeExternalBrowser implements ExternalBrowser {
  final opened = <Uri>[];

  /// What [open] answers, standing in for a device with nothing to take it.
  var succeeds = true;

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return succeeds;
  }
}
