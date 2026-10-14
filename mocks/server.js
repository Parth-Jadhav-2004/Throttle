const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8899;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const server = http.createServer((req, res) => {
  const hostHeader = req.headers['host'] || `127.0.0.1:${PORT}`;
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${hostHeader}`);
  } catch {
    parsedUrl = { pathname: req.url || '/' };
  }

  let pathname = decodeURIComponent(parsedUrl.pathname);

  // If path is exactly /mocks without trailing slash, redirect to /mocks/
  // so browsers resolve relative links correctly
  if (pathname === '/mocks') {
    res.writeHead(302, {
      'Location': '/mocks/',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end();
    return;
  }

  // Strip /mocks prefix if forwarded with prefix intact
  if (pathname.startsWith('/mocks/')) {
    pathname = pathname.substring(6); // leaves '/' at the start
  }

  if (!pathname || pathname === '/') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err) {
      // Fallback to index.html for unknown routes
      filePath = path.join(PUBLIC_DIR, 'index.html');
    } else if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Not Found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock server running at http://0.0.0.0:${PORT}`);
  console.log(`Tailscale URL: https://devil-1.tail1ed514.ts.net/mocks/`);
  console.log(`Tailscale IP: http://100.92.113.36:${PORT}/`);
});
