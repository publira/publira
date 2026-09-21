/// Where an email change stands once one of its two confirmation links has
/// been opened.
///
/// The API mails a link to the current address and one to the new address,
/// and moves the account only when both have been opened, in either order.
enum EmailChangeProgress {
  /// Both links have been opened and the account holds the new address.
  changed,

  /// The link to the new address has been opened; the current one is still
  /// waited on.
  awaitingCurrentEmail,

  /// The link to the current address has been opened; the new one is still
  /// waited on.
  awaitingNewEmail,
}
