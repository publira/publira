// A one-origin stand-in for a device, so that a browser can run this app.
//
// On a phone the app holds the address of `publira server` and calls it
// itself. A browser holds a page to the origin it came from, so this serves
// what `flutter build web` produced and hands on the two prefixes the app asks
// the server for -- `/api/...` and `/images/...` -- to the development
// profile's own server.
//
// Every header the app set travels as it was written. That is the whole point
// of going to the server directly rather than through the profile's edge,
// which overwrites `X-Forwarded-Host` -- the app's way of naming the tenant --
// with its own host name.
//
//   dart run scripts/web_app_server.dart --port 14460 \
//     --server http://127.0.0.1:14410 --root build/web

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

const _serverPrefixes = ['/api/', '/images/'];

/// Headers that describe one hop and are not passed on to the next.
const _hopByHopHeaders = <String>{
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
};

/// Request headers this server decides for itself. `HttpClient` writes the
/// length of what it sends, and negotiates its own transfer encoding.
const _rewrittenRequestHeaders = <String>{
  ..._hopByHopHeaders,
  'accept-encoding',
  'content-length',
};

/// Response headers that describe the body as it arrived rather than the body
/// written back: `HttpClient` has already decompressed what it read.
const _rewrittenResponseHeaders = <String>{
  ..._hopByHopHeaders,
  'content-encoding',
  'content-length',
};

/// What a built file is served as. A Flutter web build is HTML, JavaScript,
/// the CanvasKit WebAssembly module, fonts, and images; anything else it
/// carries is bytes the browser is not asked to interpret.
const _mimeTypes = <String, String>{
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

Future<void> main(List<String> arguments) async {
  final options = _Options.parse(arguments);
  final client = HttpClient();
  final server = await HttpServer.bind(
    InternetAddress.loopbackIPv4,
    options.port,
  );
  stdout.writeln(
    'mobile web app on http://127.0.0.1:${server.port} '
    '(server ${options.server})',
  );
  await for (final request in server) {
    unawaited(_handle(request, client, options));
  }
}

Future<void> _handle(
  HttpRequest request,
  HttpClient client,
  _Options options,
) async {
  try {
    final path = request.uri.path;
    if (_serverPrefixes.any(path.startsWith)) {
      await _forward(request, client, options.server);
    } else {
      await _serve(request, options.root);
    }
  } catch (error) {
    // A backend that is not listening is the ordinary failure here, and it
    // has to reach the app as a response rather than as a dropped connection:
    // that is what the screen under photograph reports on.
    stderr.writeln('${request.method} ${request.uri}: $error');
    await _close(request, HttpStatus.badGateway, 'upstream failed: $error');
  }
}

Future<void> _forward(
  HttpRequest request,
  HttpClient client,
  Uri backend,
) async {
  final body = await _read(request);
  final forwarded = await client.openUrl(
    request.method,
    backend.replace(
      path: request.uri.path,
      query: request.uri.hasQuery ? request.uri.query : null,
    ),
  );
  request.headers.forEach((name, values) {
    if (_rewrittenRequestHeaders.contains(name)) {
      return;
    }
    for (final value in values) {
      forwarded.headers.add(name, value);
    }
  });
  if (body.isNotEmpty) {
    forwarded.add(body);
  }
  final response = await forwarded.close();
  request.response.statusCode = response.statusCode;
  response.headers.forEach((name, values) {
    if (_rewrittenResponseHeaders.contains(name)) {
      return;
    }
    for (final value in values) {
      request.response.headers.add(name, value);
    }
  });
  await response.pipe(request.response);
}

Future<Uint8List> _read(HttpRequest request) async {
  final bytes = BytesBuilder(copy: false);
  await for (final chunk in request) {
    bytes.add(chunk);
  }
  return bytes.takeBytes();
}

Future<void> _serve(HttpRequest request, Directory root) async {
  final path = request.uri.path == '/' ? 'index.html' : request.uri.path;
  final relative = path.startsWith('/') ? path.substring(1) : path;
  if (relative.isEmpty || relative.contains('..')) {
    await _close(request, HttpStatus.notFound, 'not found');
    return;
  }
  final file = File('${root.path}/$relative');
  if (!file.existsSync()) {
    await _close(request, HttpStatus.notFound, 'not found');
    return;
  }
  final dot = relative.lastIndexOf('.');
  final extension = dot < 0 ? '' : relative.substring(dot).toLowerCase();
  request.response.headers
    ..set(
      HttpHeaders.contentTypeHeader,
      _mimeTypes[extension] ?? 'application/octet-stream',
    )
    // Each run serves the build that replaced the one before it, on the port
    // the one before it used.
    ..set(HttpHeaders.cacheControlHeader, 'no-store');
  await request.response.addStream(file.openRead());
  await request.response.close();
}

Future<void> _close(HttpRequest request, int status, String message) async {
  try {
    request.response
      ..statusCode = status
      ..headers.set(HttpHeaders.contentTypeHeader, 'text/plain; charset=utf-8')
      ..write(message);
    await request.response.close();
  } catch (error) {
    stderr.writeln('could not answer ${request.uri}: $error');
  }
}

class _Options {
  const _Options({
    required this.port,
    required this.server,
    required this.root,
  });

  factory _Options.parse(List<String> arguments) {
    final values = <String, String>{};
    for (var index = 0; index + 1 < arguments.length; index += 2) {
      values[arguments[index]] = arguments[index + 1];
    }
    final port = int.tryParse(values['--port'] ?? '');
    final server = values['--server'];
    final root = values['--root'];
    if (port == null || server == null || root == null) {
      stderr.writeln(
        'usage: dart run scripts/web_app_server.dart '
        '--port <port> --server <url> --root <directory>',
      );
      exit(2);
    }
    return _Options(
      port: port,
      server: Uri.parse(server),
      root: Directory(root),
    );
  }

  final int port;
  final Uri server;
  final Directory root;
}
