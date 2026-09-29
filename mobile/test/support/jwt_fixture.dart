import 'dart:convert';

/// A JWT carrying [subject], signed with nothing.
///
/// Only image-server verifies the token. The app reads it for the `sub` claim
/// the content key is derived from, so a fixture needs no real signature.
String jwtWithSubject(String subject) {
  String segment(Map<String, Object?> claims) =>
      base64Url.encode(utf8.encode(jsonEncode(claims))).replaceAll('=', '');
  return '${segment({'alg': 'HS256'})}'
      '.${segment({'sub': subject})}'
      '.signature';
}
