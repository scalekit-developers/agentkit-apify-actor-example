import http from 'http';
import { Actor } from 'apify';

const PORT = parseInt(process.env.ACTOR_WEB_SERVER_PORT ?? '4321', 10);

let server = null;

function buildAuthPage(link, serviceName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorize ${serviceName}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 480px; width: 100%; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    p  { color: #666; margin-bottom: 1.5rem; }
    a.btn { display: inline-block; background: #0a6b50; color: white; padding: 0.75rem 1.5rem;
            border-radius: 8px; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #085c44; }
    .note { margin-top: 1.5rem; font-size: 0.85rem; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Connect ${serviceName}</h1>
    <p>Click below to authorize access to your ${serviceName} account.<br/>
       The actor will continue automatically once you complete authorization.</p>
    <a class="btn" href="${link}" target="_blank" rel="noopener">Authorize ${serviceName} →</a>
    <p class="note">This page will update once authorization is complete.</p>
  </div>
</body>
</html>`;
}

function buildDonePage(serviceName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${serviceName} Authorized</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 480px; width: 100%; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ ${serviceName} Authorized</h1>
    <p style="color:#666">Returning to task — you can close this tab.</p>
  </div>
</body>
</html>`;
}

export function getLiveViewUrl() {
  const { actorId, actorRunId } = Actor.getEnv();
  return `https://${actorId}--${actorRunId}-${PORT}.runs.apify.net`;
}

export async function serveAuthPage(link, serviceName) {
  let html = buildAuthPage(link, serviceName);

  if (server) server.close();

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  server.listen(PORT);

  return {
    liveViewUrl: getLiveViewUrl(),
    markDone: () => { html = buildDonePage(serviceName); },
    close: () => server?.close(),
  };
}
