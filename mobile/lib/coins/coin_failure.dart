/// Why a call about the tenant's coins did not go through.
enum CoinFailureKind {
  /// DNS, refused connection, timeout, or Connect `unavailable`.
  network,

  /// The API no longer accepts the token the app holds, or the app holds
  /// none, so the reader signs in again before their coins are theirs to see.
  sessionExpired,

  /// The platform does not allow tenant coins, or the tenant has not turned
  /// its coins on (`COINS_UNAVAILABLE`), so nothing about them is shown.
  unavailable,

  /// The episode's coin price is no longer the one the reader was shown
  /// (`COIN_PRICE_CHANGED`), so nothing was spent.
  priceChanged,

  /// The reader's balance falls short of the price
  /// (`COIN_BALANCE_INSUFFICIENT`), so nothing was spent.
  insufficient,

  /// The reader already holds the episode, so there was nothing to pay for.
  alreadyOpen,

  /// The episode or its series is not shown here any more.
  gone,

  /// The episode is not sold here, or not sold as the kind asked for.
  notSold,

  /// The reader asked more often than the platform allows.
  tooManyRequests,

  /// Anything else.
  unexpected,
}

/// A failed call about the tenant's coins. [kind] is what the UI switches on;
/// [message] is diagnostic only and must not be shown as user-facing copy.
class CoinFailure implements Exception {
  const CoinFailure(this.kind, {this.message = ''});

  final CoinFailureKind kind;
  final String message;

  @override
  String toString() => 'CoinFailure($kind, $message)';
}
