#!/usr/bin/env node
// ===========================================================================
// A stand-in server: a small local HTTP server that answers like an external
// service (payment provider, CRM, mail API ...), so features can be built and
// tested without real accounts. The service's routes live in a module of their
// own (see example-service.mjs); this file is the generic part.
//
//   node tests/standins/standin.mjs tests/standins/example-service.mjs [--port 5090]
//
// Controls, outside the service's own paths (no key needed):
//   GET    /_standin/received[?path=/v1/items]   what arrived: method, path, headers, body
//   DELETE /_standin/received                     forget it
//   POST   /_standin/fail  {"method":"POST","path":"/v1/items","status":503,"times":1}
//                                                 the next matching call(s) answer with that status
//   GET    /_standin/state                        the service's state, as JSON
//   POST   /_standin/reset                        state back to the start, failures and log cleared
//
// In tests: import { startStandin } from './standin.mjs' and call it with the
// routes module; it listens on a free port and returns { url, close }.
// Nothing is persisted; a restart forgets everything. Node's own modules only.
// ===========================================================================
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** Turns '/v1/items/:id' into a matcher returning { id } or null. */
function compile(path) {
  const names = [];
  const pattern = new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\:([A-Za-z_][A-Za-z0-9_]*)|:([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => { names.push(a ?? b); return '([^/]+)'; }) + '/?$');
  return (actual) => {
    const match = pattern.exec(actual);
    return match ? Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])])) : null;
  };
}

async function readBody(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  if (!text) return { text, body: null };
  const type = request.headers['content-type'] ?? '';
  if (type.includes('application/json')) { try { return { text, body: JSON.parse(text) }; } catch { return { text, body: text }; } }
  if (type.includes('application/x-www-form-urlencoded')) return { text, body: Object.fromEntries(new URLSearchParams(text)) };
  return { text, body: text };
}

function send(response, status, body, headers = {}) {
  const isText = typeof body === 'string';
  response.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  response.end(body === undefined || body === null ? '' : isText ? body : JSON.stringify(body, null, 2));
}

/**
 * Starts a stand-in for a service module: { name, routes: [{ method, path, handle }], state(), authorise? }.
 * handle({ params, query, body, headers, state, request }) returns { status, body, headers } (or a promise of it).
 */
export async function startStandin(service, { port = 0, host = '127.0.0.1', quiet = false } = {}) {
  const routes = service.routes.map((route) => ({ ...route, method: route.method.toUpperCase(), match: compile(route.path) }));
  let state = service.state ? service.state() : {};
  const received = [];
  const failures = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}`);
    const { text, body } = await readBody(request);

    if (url.pathname.startsWith('/_standin/')) {
      const control = url.pathname.slice('/_standin/'.length);
      if (control === 'received' && request.method === 'GET') return send(response, 200, received.filter((one) => !url.searchParams.get('path') || one.path.startsWith(url.searchParams.get('path'))));
      if (control === 'received' && request.method === 'DELETE') { received.length = 0; return send(response, 204); }
      if (control === 'state' && request.method === 'GET') return send(response, 200, state);
      if (control === 'reset' && request.method === 'POST') { state = service.state ? service.state() : {}; received.length = 0; failures.length = 0; return send(response, 204); }
      if (control === 'fail' && request.method === 'POST') {
        const rule = { method: (body?.method ?? '*').toUpperCase(), path: body?.path ?? '*', status: Number(body?.status ?? 500), times: Number(body?.times ?? 1), body: body?.body ?? { error: 'Made to fail by the stand-in.' } };
        failures.push(rule);
        return send(response, 200, rule);
      }
      return send(response, 404, { error: 'Unknown stand-in control.' });
    }

    received.push({ at: new Date().toISOString(), method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers, body: body ?? text });

    const failure = failures.find((rule) => rule.times > 0 && (rule.method === '*' || rule.method === request.method) && (rule.path === '*' || url.pathname.startsWith(rule.path)));
    if (failure) { failure.times--; return send(response, failure.status, failure.body); }

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = route.match(url.pathname);
      if (!params) continue;
      if (service.authorise && route.public !== true && !service.authorise(request.headers)) return send(response, 401, service.unauthorised ?? { error: 'Unauthorised.' });
      try {
        const answer = await route.handle({ params, query: Object.fromEntries(url.searchParams), body, text, headers: request.headers, state, request });
        if (!quiet) console.log(`${answer?.status ?? 200} ${request.method} ${url.pathname}`);
        return send(response, answer?.status ?? 200, answer?.body, answer?.headers);
      } catch (error) {
        return send(response, 500, { error: `Stand-in route failed: ${error.message}` });
      }
    }
    return send(response, 404, service.notFound ?? { error: 'Not a stand-in address.' });
  });

  await new Promise((done) => server.listen(port, host, done));
  const url = `http://${host}:${server.address().port}`;
  return { url, server, close: () => new Promise((done) => server.close(done)) };
}

// Run from the command line: the routes module, then --port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modulePath = process.argv[2];
  if (!modulePath) { console.error('Usage: node tests/standins/standin.mjs <routes-module.mjs> [--port 5090]'); process.exit(2); }
  const portAt = process.argv.indexOf('--port');
  const service = (await import(pathToFileURL(resolve(modulePath)).href)).default;
  const { url } = await startStandin(service, { port: portAt > 0 ? Number(process.argv[portAt + 1]) : 5090 });
  console.log(`${service.name ?? 'Stand-in'} on ${url} (controls at ${url}/_standin/)`);
}
