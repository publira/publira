/// A Connect RPC error, classified by the wire `code` (not the message).
class ConnectException implements Exception {
  const ConnectException({
    required this.code,
    required this.message,
    this.fieldViolations = const [],
  });

  /// Connect code such as `not_found` or `unavailable`. Transport and invalid
  /// responses use the closest synthetic Connect code for UI classification.
  final String code;
  final String message;

  /// The request fields a `google.rpc.BadRequest` detail names, spelled as
  /// the proto spells them (`agreed_page_version_ids`).
  final List<String> fieldViolations;

  bool get isNotFound => code == 'not_found' || code == 'permission_denied';

  bool get isUnavailable =>
      code == 'unavailable' || code == 'deadline_exceeded';

  @override
  String toString() => 'ConnectException($code, $message)';
}
