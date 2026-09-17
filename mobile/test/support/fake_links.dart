import 'dart:async';

import 'package:publira/links/incoming_links.dart';
import 'package:publira/links/share_sheet.dart';

/// Incoming URLs a test writes, so routing can be driven without the OS.
class FakeIncomingLinks implements IncomingLinks {
  FakeIncomingLinks({this.initialUri});

  /// The URL that opened a terminated app, which [initial] reports once.
  Uri? initialUri;

  final controller = StreamController<Uri>.broadcast();

  Future<void> close() async {
    await controller.close();
  }

  @override
  Future<Uri?> get initial async => initialUri;

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
