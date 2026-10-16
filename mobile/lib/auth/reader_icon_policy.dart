/// An icon the tenant offers its readers to pick.
class ReaderIconPreset {
  const ReaderIconPreset({required this.id, required this.iconUrl});

  /// What `AuthService.SelectMyIcon` is sent to show this preset, and what
  /// `AuthSession.userIconPresetId` holds while the account shows it.
  final String id;

  /// Absolute image-server URL of the preset's image.
  final Uri iconUrl;
}

/// What a reader of the tenant may show as an icon, which decides the icon
/// controls the account screen offers, so none of them leads to a change the
/// API refuses under the tenant's policy.
sealed class ReaderIconChoice {
  const ReaderIconChoice();
}

/// An image of the reader's own, sent with `AuthService.UploadMyIcon`.
final class ReaderIconUpload extends ReaderIconChoice {
  const ReaderIconUpload();
}

/// One of the tenant's [presets], picked with `AuthService.SelectMyIcon`.
final class ReaderIconPresets extends ReaderIconChoice {
  const ReaderIconPresets(this.presets);

  /// Oldest first, and only the ones that have an image to draw.
  final List<ReaderIconPreset> presets;
}

/// No icon at all. The tenant cleared every reader's icon when it chose this.
final class ReaderIconDisabled extends ReaderIconChoice {
  const ReaderIconDisabled();
}
