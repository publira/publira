// Where the build configuration generated from an app manifest is written.

import 'dart:io';
import 'dart:math';

/// The directory a build writes into when it is not given one. Git ignores it
/// (see `mobile/.gitignore`); a build running beside another passes its own
/// directory so that neither reads what the other wrote.
Directory defaultGeneratedDirectory(Directory mobileDirectory) =>
    Directory('${mobileDirectory.path}/.generated');

/// The variable naming the directory a build writes into and the platform
/// builds read from, which `android/app/build.gradle.kts` reads as well.
const generatedDirectoryVariable = 'PUBLIRA_MOBILE_GENERATED_DIR';

/// The directory [environment] names, resolved against [mobileDirectory] as
/// Gradle resolves it, or the default one when it names none.
Directory generatedDirectory(
  Directory mobileDirectory,
  Map<String, String> environment,
) {
  final named = environment[generatedDirectoryVariable] ?? '';
  if (named.isEmpty) {
    return defaultGeneratedDirectory(mobileDirectory);
  }
  return Directory.fromUri(
    mobileDirectory.absolute.uri.resolveUri(Uri.directory(named)),
  );
}

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
    // Windows also reads `\` and a drive's `:` as parts of a path.
    if (name.isEmpty ||
        name.contains(RegExp(r'[/\\:]')) ||
        name.startsWith('.')) {
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

/// [text] as it can be written into a comment line of a generated file: each
/// character that could end the line, which would let the rest of [text] be
/// read as a setting, is replaced.
String commentText(String text) =>
    text.replaceAll(RegExp('[\\x00-\\x1F\\x7F\\u2028\\u2029]'), '�');
