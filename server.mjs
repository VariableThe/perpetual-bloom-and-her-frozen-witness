#!/usr/bin/env node
/* Zero-dependency static server for the local reader. */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const SHOULD_OPEN = process.argv.includes('--open') || process.env.OPEN === '1';

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] };

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.on('error', (error) => {
    console.warn(`Could not open the browser automatically: ${error.message}`);
  });
  child.unref();
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8']
]);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

/* Text and structured formats benefit from compression; binary images and
   WOFF/WOFF2 fonts are already compressed and must never be re-compressed. */
function isCompressible(contentType) {
  const base = contentType.split(';', 1)[0].trim().toLowerCase();
  return base.startsWith('text/')
    || base === 'application/json'
    || base === 'image/svg+xml'
    || base === 'application/javascript'
    || base === 'text/javascript';
}

function chooseEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  const header = String(acceptEncoding).toLowerCase();
  if (/\bbr\b/.test(header)) return 'br';
  if (/\bgzip\b/.test(header)) return 'gzip';
  return null;
}

function sendText(response, status, message) {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${status}</title>` +
    `<body style="font:16px/1.6 system-ui;padding:3rem;max-width:42rem;margin:auto">` +
    `<h1>${status}</h1><p>${message}</p><p><a href="/">Return to Perpetual Bloom</a></p>`;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) return null;

  let filePath = path.resolve(ROOT, `.${decoded}`);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (filePath !== ROOT && !filePath.startsWith(rootPrefix)) return null;

  if (filePath === ROOT) filePath = path.join(ROOT, 'index.html');

  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    return filePath;
  }

  return filePath;
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  } catch {
    sendText(response, 400, 'That address could not be read.');
    return;
  }

  const filePath = resolveFile(pathname);
  if (!filePath) {
    sendText(response, 403, 'That path is outside the book.');
    return;
  }

  /* The plaintext book source is never served: content/book.json lives
     outside the served tree and data/book.json must not exist. Answer 404
     so a blocked path is indistinguishable from a missing one. */
  if (pathname === '/data/book.json' || pathname.startsWith('/content/')) {
    sendText(response, 404, 'This page has slipped loose. Check the address and try again.');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendText(response, 404, 'This page has slipped loose. Check the address and try again.');
      return;
    }

    const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    const compressible = isCompressible(contentType);
    const encoding = compressible ? chooseEncoding(request.headers['accept-encoding']) : null;

    const relative = path.relative(ROOT, filePath).split(path.sep).join('/');
    /* Edition data (book.enc.json, story.config.json) changes only on
       deploy, so browsers may cache it briefly and revalidate in the
       background. Binary art and fonts carry immutable
       hashes-in-practice and cache for a year. Plaintext (content/,
       data/book.json) is never served. */
    const cacheControl = relative.startsWith('assets/fonts/') || relative.startsWith('assets/art/')
      ? 'public, max-age=31536000, immutable'
      : relative.startsWith('data/')
        ? 'public, max-age=3600, stale-while-revalidate=86400'
        : 'no-cache';
    const etag = `"${stats.size}-${stats.mtimeMs}"`;
    const lastModified = stats.mtime.toUTCString();

    const ifNoneMatch = request.headers['if-none-match'];
    const ifModifiedSince = request.headers['if-modified-since'];
    const notModified = ifNoneMatch
      ? ifNoneMatch.split(',').some((candidate) => candidate.trim() === etag)
      : Boolean(ifModifiedSince && Math.floor(stats.mtimeMs / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000));
    if (notModified) {
      const headers304 = {
        ...SECURITY_HEADERS,
        'Cache-Control': cacheControl,
        ETag: etag,
        'Last-Modified': lastModified
      };
      if (compressible) headers304.Vary = 'Accept-Encoding';
      response.writeHead(304, headers304);
      response.end();
      return;
    }

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': lastModified
    };
    if (compressible) headers.Vary = 'Accept-Encoding';
    if (encoding) {
      headers['Content-Encoding'] = encoding;
    } else {
      headers['Content-Length'] = stats.size;
    }

    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) sendText(response, 500, 'The file could not be read.');
      else response.destroy();
    });

    if (encoding) {
      const compressor = encoding === 'br' ? zlib.createBrotliCompress() : zlib.createGzip();
      compressor.on('error', () => response.destroy());
      stream.pipe(compressor).pipe(response);
    } else {
      stream.pipe(response);
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other server or run with another PORT.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}". Use a number from 1 to 65535.`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Perpetual Bloom is open at ${url}`);
  console.log('Press Ctrl+C to stop.');
  if (SHOULD_OPEN) openBrowser(url);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
