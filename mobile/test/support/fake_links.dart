import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

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

  /// The files [shareFile] was handed, in order.
  final files = <SharedFile>[];

  /// Thrown by [shareFile], standing in for a platform that cannot open the
  /// sheet.
  Exception? fileFailure;

  @override
  Future<void> shareFile({
    required Uint8List bytes,
    required String name,
    required String mimeType,
    required String title,
  }) async {
    final failure = fileFailure;
    if (failure != null) {
      throw failure;
    }
    files.add(
      SharedFile(bytes: bytes, name: name, mimeType: mimeType, title: title),
    );
  }
}

/// One file a [FakeShareSheet] was handed.
class SharedFile {
  const SharedFile({
    required this.bytes,
    required this.name,
    required this.mimeType,
    required this.title,
  });

  final Uint8List bytes;
  final String name;
  final String mimeType;
  final String title;

  /// [bytes] read as the UTF-8 text a CSV is written in. The decoder drops a
  /// leading byte order mark, so a test reads that from [bytes].
  String get text => utf8.decode(bytes);
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
