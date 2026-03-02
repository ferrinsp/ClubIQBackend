import http from 'node:http';
import { env } from './src/env.js';
import { handler } from './src/handler.js';

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await collectBody(req);
  const url = new URL(req.url ?? '/', `http://localhost:${env.PORT}`);

  // Build APIGatewayProxyEventV2-shaped object
  const event = {
    version: '2.0',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: req.headers as Record<string, string>,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    requestContext: {
      http: {
        method: req.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: req.headers['user-agent'] ?? '',
      },
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: crypto.randomUUID(),
      routeKey: `${req.method} ${url.pathname}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body || undefined,
    isBase64Encoded: false,
  };

  try {
    const result = await (handler as any)(event, {}) as any;
    const statusCode = result?.statusCode ?? 500;
    const headers = result?.headers ?? {};
    const responseBody = result?.body ?? '';

    res.writeHead(statusCode, headers);
    res.end(responseBody);
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }));
  }
});

server.listen(env.PORT, () => {
  console.log(`\n  ClubIQ API running at http://localhost:${env.PORT}`);
  console.log(`  Health check:  http://localhost:${env.PORT}/health\n`);
});
