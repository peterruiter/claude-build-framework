// ===========================================================================
// Example routes for standin.mjs: a made-up "items" API with a bearer key,
// pagination, an Idempotency-Key on create and the service's own error shape.
// Copy this file per external service and answer the way that service's docs
// say it answers: status codes, field names, pagination, errors.
//
//   node tests/standins/standin.mjs tests/standins/example-service.mjs --port 5090
//   App setting: ExampleService:BaseUrl=http://127.0.0.1:5090/v1
//
// Any key starting with "test_" is accepted, except one ending in "bad".
// ===========================================================================
import { randomBytes } from 'node:crypto';

const id = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;

export default {
  name: 'Example service stand-in',
  state: () => ({ items: [], idempotency: {} }),
  authorise: (headers) => {
    const key = (headers.authorization ?? '').replace(/^Bearer /, '');
    return key.startsWith('test_') && !key.endsWith('bad');
  },
  unauthorised: { error: { code: 'invalid_key', message: 'Invalid API key.' } },
  notFound: { error: { code: 'not_found', message: 'No such resource.' } },
  routes: [
    {
      method: 'GET', path: '/health', public: true,
      handle: () => ({ status: 200, body: { ok: true } }),
    },
    {
      method: 'GET', path: '/v1/items',
      handle: ({ query, state }) => {
        const limit = Math.min(Number(query.limit ?? 10), 100);
        const start = query.after ? state.items.findIndex((item) => item.id === query.after) + 1 : 0;
        const page = state.items.slice(start, start + limit);
        return { status: 200, body: { data: page, has_more: start + limit < state.items.length } };
      },
    },
    {
      method: 'GET', path: '/v1/items/:id',
      handle: ({ params, state }) => {
        const item = state.items.find((one) => one.id === params.id);
        return item ? { status: 200, body: item } : { status: 404, body: { error: { code: 'not_found', message: `No item ${params.id}.` } } };
      },
    },
    {
      method: 'POST', path: '/v1/items',
      handle: ({ body, headers, state }) => {
        const key = headers['idempotency-key'];
        if (key && state.idempotency[key]) return { status: 200, body: state.idempotency[key] };
        if (!body?.name) return { status: 422, body: { error: { code: 'missing_name', message: 'name is required.' } } };
        const item = { id: id('itm'), name: String(body.name), created: Math.floor(Date.now() / 1000) };
        state.items.push(item);
        if (key) state.idempotency[key] = item;
        return { status: 201, body: item };
      },
    },
    {
      method: 'DELETE', path: '/v1/items/:id',
      handle: ({ params, state }) => {
        const at = state.items.findIndex((one) => one.id === params.id);
        if (at < 0) return { status: 404, body: { error: { code: 'not_found', message: `No item ${params.id}.` } } };
        state.items.splice(at, 1);
        return { status: 204 };
      },
    },
  ],
};
