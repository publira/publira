import 'package:flutter/foundation.dart';

/// One notification as it reaches the app.
///
/// [title] and [body] are what the OS drew while the app was backgrounded or
/// terminated, and what the app itself has to draw when the message arrives in
/// the foreground, because FCM does not display one then. [data] is the
/// routing block the server sent alongside it.
@immutable
class PushMessage {
  const PushMessage({
    this.title = '',
    this.body = '',
    this.data = const <String, String>{},
  });

  /// Reads a message the platform handed over, keeping only the string entries
  /// of `data`. FCM types that map as `Object?`, and a value of another type is
  /// one no key of this payload has.
  factory PushMessage.fromPlatform({
    String? title,
    String? body,
    Map<Object?, Object?> data = const <Object?, Object?>{},
  }) {
    final entries = <String, String>{};
    for (final entry in data.entries) {
      final key = entry.key;
      final value = entry.value;
      if (key is String && value is String) {
        entries[key] = value;
      }
    }
    return PushMessage(title: title ?? '', body: body ?? '', data: entries);
  }

  final String title;
  final String body;
  final Map<String, String> data;

  /// The in-app location this notification points at, or an empty string when
  /// it names none the app can open.
  ///
  /// The value arrives over the network, so only a path of this app is
  /// accepted: anything carrying a scheme or a host would send the reader
  /// somewhere the notification has no business opening.
  String get route {
    final raw = data['route']?.trim() ?? '';
    if (!raw.startsWith('/')) {
      return '';
    }
    final parsed = Uri.tryParse(raw);
    if (parsed == null || parsed.hasScheme || parsed.hasAuthority) {
      return '';
    }
    return raw;
  }

  /// Whether there is anything to draw for a message that arrived while the
  /// app was in front.
  bool get hasCopy => title.isNotEmpty || body.isNotEmpty;
}
