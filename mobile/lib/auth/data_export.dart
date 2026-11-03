/// What became of the reader's request for an archive of what the install
/// keeps about them.
enum DataExportState {
  /// Asked for, and not built yet. The API refuses another request until it
  /// is.
  pending,

  /// Built, and downloadable until [DataExport.expiresAt].
  ready,

  /// Given up on, because the install had no object store to keep it in. The
  /// reader may ask again.
  failed,
}

/// The reader's latest request for their archive: a ZIP of one JSON file per
/// kind of record, with the purchase history CSV beside them.
class DataExport {
  const DataExport({required this.state, this.expiresAt});

  final DataExportState state;

  /// When a ready archive is deleted and stops downloading, and `null` while
  /// the request is pending or when the API sent a timestamp this build could
  /// not read.
  final DateTime? expiresAt;
}

/// The name the archive is handed to the share sheet under, the one the
/// site's download saves it as.
const dataExportFileName = 'data-export.zip';

/// The media type of the archive.
const dataExportMimeType = 'application/zip';
