/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Proxy the demo through a second origin without starting a second Rails app.
const http = require('node:http');

http.createServer((req, res) => {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: 3067,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:3067' },
  }, (reply) => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', (error) => {
    res.writeHead(502);
    res.end(String(error));
  });
  req.pipe(upstream);
}).listen(3068, '127.0.0.1', () => {
  console.log('Second demo origin: http://localhost:3068 -> http://127.0.0.1:3067');
});
