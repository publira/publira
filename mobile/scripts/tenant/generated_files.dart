// Where the build configuration generated from a tenant manifest is written.

import 'dart:io';
import 'dart:math';

/// The directory a build writes into when it is not given one. Git ignores it
/// (see `mobile/.gitignore`); a build running beside another passes its own
/// directory so that neither reads what the other wrote.
Directory defaultGeneratedDirectory(Directory mobileDirectory) =>
    Directory('${mobileDirectory.path}/.generated');

/// Writes each of [files], keyed by name, into [directory].
///
/// Each file is written under a name no other writer uses and then renamed
/// into place, so that a platform build reading it sees either the previous
/// contents or the new ones and never a half-written file.
Future<void> writeGeneratedFiles(
  Directory directory,
  Map<String, String> files,
) async {
  await directory.create(recursive: true);
  final random = Random.secure();
  for (final MapEntry(key: name, value: contents) in files.entries) {
    if (name.isEmpty || name.contains('/') || name.startsWith('.')) {
      throw ArgumentError.value(name, 'files', 'must be a plain file name');
    }
    final suffix = random.nextInt(1 << 32).toRadixString(16);
    final staging = File('${directory.path}/.$name.$pid.$suffix.tmp');
    try {
      await staging.writeAsString(contents, flush: true);
      await staging.rename('${directory.path}/$name');
    } finally {
      if (await staging.exists()) {
        await staging.delete();
      }
    }
  }
}
