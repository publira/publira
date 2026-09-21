import 'dart:async';

import 'package:flutter/material.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/auth_scope.dart';
import 'package:publira/auth/signed_out_notice.dart';
import 'package:publira/forms/name_input.dart';
import 'package:publira/l10n/gen/app_messages.dart';

/// Renames the signed-in account through `AuthService/UpdateMe`.
class EditNameScreen extends StatefulWidget {
  const EditNameScreen({super.key});

  @override
  State<EditNameScreen> createState() => _EditNameScreenState();
}

class _EditNameScreenState extends State<EditNameScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();

  var _started = false;
  var _submitting = false;
  AuthFailureKind? _failure;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) {
      return;
    }
    _started = true;
    _nameController.text = AuthScope.of(context).session?.userName ?? '';
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final messages = AppMessages.of(context);
    setState(() {
      _submitting = true;
      _failure = null;
    });
    AuthFailureKind? failure;
    try {
      await auth.updateName(_nameController.text.trim());
    } on AuthFailure catch (error) {
      failure = error.kind;
    } on Exception {
      failure = AuthFailureKind.unexpected;
    }
    if (!mounted) {
      return;
    }
    if (failure == null) {
      messenger.showSnackBar(SnackBar(content: Text(messages.editNameUpdated)));
      leaveAccountSettings(context);
      return;
    }
    setState(() {
      _submitting = false;
      _failure = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = AppMessages.of(context);
    final signedIn = AuthScope.of(context).isSignedIn;
    final failure = _failure;
    return Scaffold(
      appBar: AppBar(title: Text(messages.editNameTitle)),
      body: SafeArea(
        child: !signedIn
            ? const SignedOutNotice()
            : SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (failure != null) ...[
                        Text(
                          _failureCopy(messages, failure),
                          key: const ValueKey('edit-name-error'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      TextFormField(
                        key: const ValueKey('edit-name-name'),
                        controller: _nameController,
                        decoration: InputDecoration(
                          labelText: messages.editNameLabel,
                          border: const OutlineInputBorder(),
                        ),
                        autofillHints: const [AutofillHints.name],
                        textInputAction: TextInputAction.done,
                        validator: (value) =>
                            validateDisplayName(messages, value ?? ''),
                        onFieldSubmitted: (_) => unawaited(_submit()),
                      ),
                      const SizedBox(height: 24),
                      FilledButton(
                        key: const ValueKey('edit-name-submit'),
                        onPressed: _submitting
                            ? null
                            : () => unawaited(_submit()),
                        child: _submitting
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(messages.editNameSave),
                      ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  String _failureCopy(AppMessages messages, AuthFailureKind failure) {
    return switch (failure) {
      AuthFailureKind.network => messages.errorsRpcUnavailable,
      AuthFailureKind.rateLimited => messages.errorsRpcRateLimited,
      _ => messages.editNameFailed,
    };
  }
}
