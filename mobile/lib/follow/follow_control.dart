import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/follow/follow_failure.dart';
import 'package:publira/follow/follow_repository.dart';
import 'package:publira/l10n/gen/app_messages.dart';
import 'package:publira/models/follow.dart';
import 'package:publira/router.dart';

/// Follows one series or one author, and stops following it.
///
/// What a reader follows is theirs alone, so a guest is offered the way to
/// sign in rather than a control that cannot act. A build carrying no
/// [FollowScope] offers nothing at all.
class FollowControl extends StatefulWidget {
  const FollowControl({
    super.key,
    required this.kind,
    required this.targetId,
    required this.targetName,
    this.following,
  });

  final FollowTargetKind kind;

  /// Public id of the series or author this control acts on.
  final String targetId;

  /// What the target is called, which is the only thing telling one control
  /// on a screen from the next one to a screen reader.
  final String targetName;

  /// The state the caller already knows, which is what keeps a list of
  /// follows from asking the API once per row. `null` asks for it.
  final bool? following;

  @override
  State<FollowControl> createState() => _FollowControlState();
}

class _FollowControlState extends State<FollowControl> {
  /// Whether the reader follows the target, and `null` while that is unknown:
  /// before the first answer, and after one that failed. An unknown state
  /// offers to follow, which is the request the API answers the same way
  /// whether or not the follow is already there.
  bool? _following;

  var _loading = false;
  var _submitting = false;
  var _accessToken = '';
  var _started = false;
  var _requests = 0;

  /// Reads the state again whenever the reader changes, because the follow
  /// belongs to whoever holds the session rather than to the device.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final accessToken = AuthScope.of(context).accessToken;
    if (_started && accessToken == _accessToken) {
      return;
    }
    _started = true;
    _accessToken = accessToken;
    _requests++;
    _following = accessToken.isEmpty ? null : widget.following;
    if (accessToken.isNotEmpty && _following == null) {
      _load();
    }
  }

  Future<void> _load() async {
    final repository = FollowScope.maybeOf(context);
    if (repository == null) {
      return;
    }
    final request = _request();
    setState(() => _loading = true);
    try {
      final following = await repository.isFollowing(
        widget.kind,
        widget.targetId,
      );
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _following = following);
    } on FollowFailure {
      // The state stays unknown, which leaves the control offering to follow.
      // Nothing is said here: the reader asked for the screen, not for this.
    } finally {
      if (_isCurrent(request)) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _toggle() async {
    final repository = FollowScope.maybeOf(context);
    if (repository == null) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    final unfollowing = _following ?? false;
    final request = _request();
    setState(() => _submitting = true);
    try {
      final following = unfollowing
          ? await repository.unfollow(widget.kind, widget.targetId)
          : await repository.follow(widget.kind, widget.targetId);
      if (!_isCurrent(request)) {
        return;
      }
      setState(() => _following = following);
    } on FollowFailure catch (failure) {
      if (!_isCurrent(request)) {
        return;
      }
      // The reader asked for this one, so it says why it did not happen.
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            key: const ValueKey('follow-failure'),
            _failureCopy(messages, failure),
          ),
        ),
      );
    } finally {
      if (_isCurrent(request)) {
        setState(() => _submitting = false);
      }
    }
  }

  String _failureCopy(AppMessages messages, FollowFailure failure) {
    return switch (failure.kind) {
      FollowFailureKind.network => messages.errorsRpcUnavailable,
      FollowFailureKind.sessionExpired => messages.errorsRpcUnauthenticated,
      FollowFailureKind.gone => messages.errorsRpcNotFound,
      FollowFailureKind.unexpected => messages.followFailed,
    };
  }

  _FollowRequest _request() => _FollowRequest(
    generation: _requests,
    accessToken: _accessToken,
    targetId: widget.targetId,
  );

  bool _isCurrent(_FollowRequest request) =>
      mounted &&
      request.generation == _requests &&
      request.accessToken == _accessToken &&
      request.targetId == widget.targetId;

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    if (FollowScope.maybeOf(context) == null) {
      return const SizedBox.shrink();
    }
    if (!AuthScope.of(context).isSignedIn) {
      void openSignIn() => context.push(AppRoutes.signIn);
      return _Labelled(
        label: messages.followSignInAria(name: widget.targetName),
        onTap: openSignIn,
        child: OutlinedButton(
          key: ValueKey('follow-sign-in-${widget.targetId}'),
          onPressed: openSignIn,
          child: Text(messages.followSignIn),
        ),
      );
    }
    final following = _following ?? false;
    final onPressed = _loading || _submitting ? null : _toggle;
    final label = Text(
      _submitting
          ? messages.followUpdating
          : following
          ? messages.followUnfollow
          : messages.followFollow,
    );
    return _Labelled(
      label: following
          ? messages.followUnfollowAria(name: widget.targetName)
          : messages.followFollowAria(name: widget.targetName),
      onTap: onPressed,
      child: following
          ? OutlinedButton(
              key: ValueKey('follow-${widget.targetId}'),
              onPressed: onPressed,
              child: label,
            )
          : FilledButton(
              key: ValueKey('follow-${widget.targetId}'),
              onPressed: onPressed,
              child: label,
            ),
    );
  }
}

/// The button as a screen reader reads it: the same word on every control of
/// a screen says which one it is only once the target is in it.
///
/// Excluding the button's own semantics takes its tap action with them, so
/// [onTap] puts it back — a pointer still reaches the button underneath, and
/// this is what assistive technology activates. `null` is the button while it
/// cannot be pressed.
class _Labelled extends StatelessWidget {
  const _Labelled({
    required this.label,
    required this.onTap,
    required this.child,
  });

  final String label;
  final VoidCallback? onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: child,
    );
  }
}

class _FollowRequest {
  const _FollowRequest({
    required this.generation,
    required this.accessToken,
    required this.targetId,
  });

  final int generation;
  final String accessToken;
  final String targetId;
}
