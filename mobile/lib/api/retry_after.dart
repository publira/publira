/// The wait a refusal's `Retry-After` asks for, read from [headers] under
/// their lower-cased names, or `null` when it names none.
///
/// Only the delay in seconds is read, which is the form `publira server`,
/// image-server, and the sample edges in `infra/proxy/` write. An HTTP date
/// would be read against the device's clock, which a refusal has no reason to
/// trust, so it reads as no wait at all.
Duration? retryAfterOf(Map<String, String> headers) {
  final value = headers['retry-after']?.trim() ?? '';
  if (value.isEmpty || !RegExp(r'^\d+$').hasMatch(value)) {
    return null;
  }
  final seconds = int.tryParse(value);
  return seconds == null ? null : Duration(seconds: seconds);
}
