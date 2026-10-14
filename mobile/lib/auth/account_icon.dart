import 'dart:typed_data';

/// The most `AuthService.UploadMyIcon` takes of an icon, checked before the
/// upload is sent so a file the API would refuse is not carried across the
/// network first. The API stays the authority: what passes here can still be
/// refused, and the account screen says so when it is.
const accountIconMaxBytes = 10 * 1024 * 1024;

/// The shortest side the API cuts its square from and still stores.
const accountIconMinDimension = 128;

/// An image the reader picked for their icon, with the type it was found to
/// be.
class AccountIconUpload {
  const AccountIconUpload({required this.bytes, required this.contentType});

  final Uint8List bytes;
  final String contentType;
}

/// Why a picked image cannot become an icon.
enum AccountIconProblem { tooLarge, tooSmall, unsupported }

/// [bytes] as the upload they make, or the reason they make none.
///
/// Only the three formats the site and the consoles offer for an icon are
/// taken. The API takes any `image/*` it can decode, so a HEIC, a GIF, or
/// anything the picker hands over under a name that does not match its
/// contents is turned away here rather than after the upload. The size is
/// read from the image's own header: the API cuts a square from the centre,
/// so the shorter side is the side the icon gets.
(AccountIconUpload?, AccountIconProblem?) prepareAccountIcon(Uint8List bytes) {
  final header = _readHeader(bytes);
  if (header == null) {
    return (null, AccountIconProblem.unsupported);
  }
  if (bytes.length > accountIconMaxBytes) {
    return (null, AccountIconProblem.tooLarge);
  }
  final (:contentType, :width, :height) = header;
  if ((width < height ? width : height) < accountIconMinDimension) {
    return (null, AccountIconProblem.tooSmall);
  }
  return (AccountIconUpload(bytes: bytes, contentType: contentType), null);
}

typedef _Header = ({String contentType, int width, int height});

/// The type and size of a JPEG, PNG, or WebP image, read from its header, or
/// `null` for anything else, a header cut short included.
_Header? _readHeader(Uint8List bytes) {
  bool matches(int offset, List<int> signature) {
    if (bytes.length < offset + signature.length) {
      return false;
    }
    for (var i = 0; i < signature.length; i++) {
      if (bytes[offset + i] != signature[i]) {
        return false;
      }
    }
    return true;
  }

  if (matches(0, const [0xFF, 0xD8, 0xFF])) {
    return _readJpeg(bytes);
  }
  if (matches(0, const [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) &&
      matches(12, 'IHDR'.codeUnits) &&
      bytes.length >= 24) {
    final data = ByteData.sublistView(bytes);
    return (
      contentType: 'image/png',
      width: data.getUint32(16),
      height: data.getUint32(20),
    );
  }
  if (matches(0, 'RIFF'.codeUnits) && matches(8, 'WEBP'.codeUnits)) {
    return _readWebp(bytes, matches);
  }
  return null;
}

/// The size a JPEG's start-of-frame segment states, found by walking the
/// segments before it.
_Header? _readJpeg(Uint8List bytes) {
  var offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] != 0xFF) {
      return null;
    }
    final marker = bytes[offset + 1];
    if (marker == 0xFF) {
      // Fill bytes may stand before a marker.
      offset++;
      continue;
    }
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
      offset += 2;
      continue;
    }
    final length = bytes[offset + 2] << 8 | bytes[offset + 3];
    // Every SOFn but DHT (C4), JPG (C8), and DAC (CC), which share the range.
    final isFrame =
        marker >= 0xC0 &&
        marker <= 0xCF &&
        marker != 0xC4 &&
        marker != 0xC8 &&
        marker != 0xCC;
    if (isFrame) {
      if (offset + 9 > bytes.length) {
        return null;
      }
      return (
        contentType: 'image/jpeg',
        height: bytes[offset + 5] << 8 | bytes[offset + 6],
        width: bytes[offset + 7] << 8 | bytes[offset + 8],
      );
    }
    offset += 2 + length;
  }
  return null;
}

/// The size a WebP's first chunk states, in whichever of the three forms the
/// file is: lossy (`VP8 `), lossless (`VP8L`), or extended (`VP8X`).
_Header? _readWebp(
  Uint8List bytes,
  bool Function(int offset, List<int> signature) matches,
) {
  if (matches(12, 'VP8 '.codeUnits) &&
      matches(23, const [0x9D, 0x01, 0x2A]) &&
      bytes.length >= 30) {
    return (
      contentType: 'image/webp',
      width: (bytes[26] | bytes[27] << 8) & 0x3FFF,
      height: (bytes[28] | bytes[29] << 8) & 0x3FFF,
    );
  }
  if (matches(12, 'VP8L'.codeUnits) &&
      bytes.length >= 25 &&
      bytes[20] == 0x2F) {
    return (
      contentType: 'image/webp',
      width: 1 + ((bytes[22] & 0x3F) << 8 | bytes[21]),
      height: 1 + ((bytes[24] & 0x0F) << 10 | bytes[23] << 2 | bytes[22] >> 6),
    );
  }
  if (matches(12, 'VP8X'.codeUnits) && bytes.length >= 30) {
    return (
      contentType: 'image/webp',
      width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16),
      height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16),
    );
  }
  return null;
}
