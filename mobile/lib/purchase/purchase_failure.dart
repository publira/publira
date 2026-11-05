/// Why a purchase call did not go through.
enum PurchaseFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API no longer accepts the token the app holds, so the reader signs in
  /// again before a checkout can start.
  sessionExpired,

  /// The reader already holds a purchase of the episode, so there is nothing
  /// to pay for and the episode opens instead.
  alreadyPurchased,

  /// The episode or its series is not public any more.
  gone,

  /// The device's store cannot take a payment: no store account, purchases
  /// restricted, or no store at all.
  storeUnavailable,

  /// The tenant does not sell the episode through the store right now: the
  /// store is not ready, or has no product for the episode's price.
  notSold,

  /// The store has not settled the transaction yet (Ask to Buy, a Play
  /// pending purchase), so it is confirmed again later.
  notSettled,

  /// What the store charged is recorded for another account of the tenant,
  /// which keeps it: a subscription restored while signed in to a second
  /// account.
  otherAccount,

  /// No code of the tenant's is spelled so, or it is deleted, paused, or has
  /// not started.
  promotionCodeInvalid,

  /// The promotion code's window has closed.
  promotionCodeExpired,

  /// The promotion code has been redeemed as often as it may be.
  promotionCodeExhausted,

  /// The reader has redeemed the promotion code as often as one reader may.
  promotionCodeAlreadyRedeemed,

  /// The promotion code does not apply to what the reader is buying.
  promotionCodeNotApplicable,

  /// The tenant's store sells no product at the price the promotion code
  /// leaves, so the app cannot charge it.
  promotionCodeNotInApp,

  /// The reader has entered promotion codes too many times in a short while.
  promotionCodeRateLimited,

  /// Anything else, including a tenant that has stopped taking payments.
  unexpected,
}

/// A failed purchase call. [kind] is what the UI switches on; [message] is
/// diagnostic only and must not be shown as user-facing copy.
class PurchaseFailure implements Exception {
  const PurchaseFailure(this.kind, {this.message = ''});

  final PurchaseFailureKind kind;
  final String message;

  @override
  String toString() => 'PurchaseFailure($kind, $message)';
}
