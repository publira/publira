import 'package:http/http.dart' as http;
import 'package:protobuf/protobuf.dart';

/// A Connect unary success that answers with [message] in the binary codec,
/// as connect-go answers a request the app sends.
http.Response protoResponse(
  GeneratedMessage message, {
  Map<String, String> headers = const {},
}) => protoBytesResponse(message.writeToBuffer(), headers: headers);

/// A Connect unary success whose binary body is [body] as it is, for one that
/// a generated message cannot write.
http.Response protoBytesResponse(
  List<int> body, {
  Map<String, String> headers = const {},
}) => http.Response.bytes(
  body,
  200,
  headers: {'content-type': 'application/proto', ...headers},
);

/// A binary body that does not decode: field 1, length-delimited, five bytes
/// long, and then nothing.
const undecodableBody = [0x0a, 5];
