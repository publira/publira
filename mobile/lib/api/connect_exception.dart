/// A Connect RPC error, classified by the wire `code` (not the message).
class ConnectException implements Exception {
  const ConnectException({required this.code, required this.message});

  /// Connect code such as `not_found` or `unavailable`. Empty when the
  /// response was not a Connect error body (timeout, DNS, HTTP 502, …).
  final String code;
  final String message;

  bool get isNotFound => code == 'not_found' || code == 'permission_denied';

  bool get isUnavailable =>
      code == 'unavailable' || code == 'deadline_exceeded';

  @override
  String toString() => 'ConnectException($code, $message)';
}
