import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Serves the built React app from the same process and origin as the API.
 *
 * One origin is what lets the session cookie be first-party with no proxy in
 * between: `/api/*` reaches the controllers, everything else is the web app.
 * Hashed assets under `/assets` never change, so they are cached for a year;
 * `index.html` is never cached, so a deploy is picked up on the next load.
 *
 * Any other GET that is not a file is a client-side route (`/overview`,
 * `/accounts/…`), and gets `index.html` so React Router can draw it.
 */
export function serveWebApp(app: NestExpressApplication, webDir: string): void {
  const root = resolve(webDir);
  const indexHtml = join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`CRED_STATS_WEB_DIR has no index.html: ${root}`);
  }

  app.useStaticAssets(root, {
    index: false,
    setHeaders: (response, path) => {
      response.setHeader(
        'cache-control',
        path.includes(`${join(root, 'assets')}`)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300',
      );
    },
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const isPage =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.path.startsWith('/api/') &&
      request.path !== '/api' &&
      request.accepts('html') !== false;
    if (!isPage) {
      next();
      return;
    }
    response.setHeader('cache-control', 'no-cache');
    response.sendFile(indexHtml);
  });
}
