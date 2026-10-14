import 'dart:typed_data';

/// The headers of the images a reader picks for an icon, as far as the app
/// reads one: enough for its type and its size, with [padding] zero bytes
/// after it to make the file as large as a test needs.

/// A PNG's signature and `IHDR` chunk.
Uint8List pngIcon({int width = 256, int height = 256, int padding = 0}) {
  final header = ByteData(33)
    ..setUint32(0, 0x89504E47)
    ..setUint32(4, 0x0D0A1A0A)
    ..setUint32(8, 13)
    ..setUint32(12, 0x49484452)
    ..setUint32(16, width)
    ..setUint32(20, height)
    ..setUint8(24, 8)
    ..setUint8(25, 6);
  return _padded(header.buffer.asUint8List(), padding);
}

/// A JPEG's start of image, a JFIF segment and a quantization table ahead of
/// its frame the way an encoder writes them, then the progressive frame.
Uint8List jpegIcon({int width = 256, int height = 256}) {
  return Uint8List.fromList([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, ...'JFIF'.codeUnits, 0x00, //
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xFF, 0xDB, 0x00, 0x05, 0x00, 0x01, 0x01, // DQT, cut to one value
    0xFF, 0xC2, 0x00, 0x11, 0x08, //
    height >> 8, height & 0xFF, width >> 8, width & 0xFF, 0x03, // SOF2
  ]);
}

/// A WebP in one of its three forms: lossy (`VP8 `), lossless (`VP8L`), or
/// extended (`VP8X`), which is what an image with an alpha channel is.
Uint8List webpIcon(WebpForm form, {int width = 256, int height = 256}) {
  final chunk = switch (form) {
    WebpForm.lossy => [
      ...'VP8 '.codeUnits, 0x10, 0x00, 0x00, 0x00, //
      0x00, 0x00, 0x00, 0x9D, 0x01, 0x2A, //
      width & 0xFF, width >> 8, height & 0xFF, height >> 8,
    ],
    WebpForm.lossless => [
      ...'VP8L'.codeUnits, 0x10, 0x00, 0x00, 0x00, 0x2F, //
      (width - 1) & 0xFF,
      ((width - 1) >> 8) & 0x3F | ((height - 1) & 0x03) << 6,
      ((height - 1) >> 2) & 0xFF,
      ((height - 1) >> 10) & 0x0F,
    ],
    WebpForm.extended => [
      ...'VP8X'.codeUnits, 0x0A, 0x00, 0x00, 0x00, //
      0x10, 0x00, 0x00, 0x00, //
      (width - 1) & 0xFF, ((width - 1) >> 8) & 0xFF, (width - 1) >> 16,
      (height - 1) & 0xFF, ((height - 1) >> 8) & 0xFF, (height - 1) >> 16,
    ],
  };
  return Uint8List.fromList([
    ...'RIFF'.codeUnits, 0x00, 0x00, 0x00, 0x00, ...'WEBP'.codeUnits, //
    ...chunk,
  ]);
}

enum WebpForm { lossy, lossless, extended }

Uint8List _padded(Uint8List header, int padding) {
  if (padding == 0) {
    return header;
  }
  return Uint8List(header.length + padding)..setAll(0, header);
}
