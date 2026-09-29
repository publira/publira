// What a build may not change: every file of the checkout that Git tracks or
// does not ignore.

import 'dart:io';

/// The files of a Git working tree that differ from `HEAD` or are not
/// ignored, each with what it holds.
///
/// A file that was already changed before a build keeps its status line when
/// the build changes it again, so the contents are what tell the two apart.
class WorkingTreeSnapshot {
  const WorkingTreeSnapshot._(this._files);

  /// The snapshot of the working tree [directory] is in, or `null` outside a
  /// Git checkout.
  static Future<WorkingTreeSnapshot?> take(Directory directory) async {
    final top = (await _git([
      'rev-parse',
      '--show-toplevel',
    ], directory.path))?.trim();
    if (top == null) {
      return null;
    }
    final status = await _git([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ], top);
    if (status == null) {
      return null;
    }

    // Each entry is `XY <path>`; a rename or a copy is followed by the path
    // it was made from.
    final lines = <String, String>{};
    final fields = status.split('\x00');
    for (var i = 0; i < fields.length; i++) {
      final line = fields[i];
      if (line.length < 4) {
        continue;
      }
      lines[line.substring(3)] = line;
      if ('RC'.contains(line[0]) || 'RC'.contains(line[1])) {
        i++;
      }
    }

    final present = [
      for (final path in lines.keys)
        if (await File('$top/$path').exists()) path,
    ];
    final ids = present.isEmpty
        ? const <String>[]
        : (await _git(
            ['hash-object', '--stdin-paths'],
            top,
            input: present.join('\n'),
          ))?.trim().split('\n');
    if (ids == null || ids.length != present.length) {
      return null;
    }
    final objects = Map.fromIterables(present, ids);
    return WorkingTreeSnapshot._({
      for (final MapEntry(key: path, value: line) in lines.entries)
        path: (line: line, object: objects[path]),
    });
  }

  final Map<String, ({String line, String? object})> _files;

  /// Each path whose status or contents differ between [earlier] and this
  /// snapshot, as its status line now, or as it was for a path that has since
  /// gone back to what `HEAD` holds.
  List<String> changedSince(WorkingTreeSnapshot earlier) => [
    for (final path in {..._files.keys, ...earlier._files.keys})
      if (_files[path] != earlier._files[path])
        _files[path]?.line ?? '${earlier._files[path]!.line} (reverted)',
  ]..sort();
}

Future<String?> _git(
  List<String> arguments,
  String directory, {
  String input = '',
}) async {
  try {
    final process = await Process.start(
      'git',
      arguments,
      workingDirectory: directory,
    );
    process.stdin.write(input);
    await process.stdin.close();
    final output = process.stdout.transform(systemEncoding.decoder).join();
    await process.stderr.drain<void>();
    return await process.exitCode == 0 ? await output : null;
  } on ProcessException {
    return null;
  }
}
