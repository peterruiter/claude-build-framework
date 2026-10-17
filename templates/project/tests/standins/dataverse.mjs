// ===========================================================================
// A stand-in for a Dataverse environment (Dynamics 365) and its Entra ID token
// service, for building and testing a CRM sync without a real environment.
// Node's own modules only.
//
// What it answers, the way the Dataverse Web API (v9.2) does:
//   POST /{tenant}/oauth2/v2.0/token            client credentials grant ("wrong" secret refused)
//   GET  /api/data/v9.2/WhoAmI                  and RetrieveVersion()
//   GET  .../EntityDefinitions?$filter=...      LogicalName, EntitySetName for contact, lead, list
//   GET  .../EntityDefinitions(LogicalName='contact')/Attributes[/Microsoft.Dynamics.CRM.StringAttributeMetadata]
//   GET  .../EntityDefinitions(LogicalName='lead')/ManyToOneRelationships
//   GET  .../contacts?$select&$filter&$orderby&$top   with Prefer: odata.maxpagesize and @odata.nextLink
//   GET  .../contacts(<id>)                     with @odata.etag and an ETag header
//   POST .../contacts                           a chosen id, duplicate key, MSCRM.SuppressDuplicateDetection: false
//   PATCH .../contacts(<id>)                    upsert; If-Match: * (update only), If-None-Match: * (create only),
//                                               If-Match: W/"n" (optimistic concurrency)
//   DELETE .../contacts(<id>)
//   GET  .../lists(<id>)/listcontact_association   static list members, paged
//   POST .../<custom trigger name>              an unbound action; every declared attribute required
//   POST .../$batch                             multipart/mixed, change sets, Prefer: odata.continue-on-error
//   GET  /main.aspx?etn=contact&id=<id>         what "open in Dynamics" would show
//
// Writes are checked as Dataverse checks them: unknown columns, text too long,
// wrong types, bindings to a navigation property the table lacks or to a
// record that is not there. Error bodies carry Dataverse's hex codes.
//
// Controls for tests (outside the API path):
//   POST /_standin/throttle?times=3&retryAfter=5   the next 3 API calls answer 429 with Retry-After: 5
//   POST /_standin/fail?times=2&status=500         the next 2 writes answer that status
//   POST /_standin/expire-tokens                   every token issued so far is refused (401)
//   POST /_standin/seed                            { "contacts": [...], "leads": [...], "lists": [...] }
//   POST /_standin/reset                           forget everything
//   GET  /_standin/state                           records, trigger calls, counters, recent requests
//
// Run:   node tests/standins/dataverse.mjs [port]       (5096 by default)
// App:   environment URL http://127.0.0.1:5096 and login base URL http://127.0.0.1:5096
//        (local runs only); any tenant and client id; any secret except "wrong".
// Tests: import { startDataverseStandin } and call it with { port: 0 }.
//
// Not covered: FetchXML, $expand, $apply, Content-ID references inside change
// sets, change tracking, real security. Nothing is persisted.
// ===========================================================================
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = '/api/data/v9.2/';
const MAX_PAGE = 5000;

// --------------------------------------------------------------- metadata --

// [name, AttributeType, maxLength | null, writable]
const TABLES = {
  contact: {
    set: 'contacts', key: 'contactid', primary: 'fullname',
    columns: [
      ['contactid', 'Uniqueidentifier', null, true], ['firstname', 'String', 50, true], ['lastname', 'String', 50, true],
      ['fullname', 'String', 160, false], ['emailaddress1', 'String', 100, true], ['emailaddress2', 'String', 100, true],
      ['emailaddress3', 'String', 100, true], ['jobtitle', 'String', 100, true], ['telephone1', 'String', 50, true],
      ['description', 'Memo', 2000, true], ['donotbulkemail', 'Boolean', null, true], ['statecode', 'State', null, true],
      ['statuscode', 'Status', null, true], ['createdon', 'DateTime', null, false], ['modifiedon', 'DateTime', null, false]
    ],
    lookups: [],
    duplicateRule: 'emailaddress1'
  },
  lead: {
    set: 'leads', key: 'leadid', primary: 'subject',
    columns: [
      ['leadid', 'Uniqueidentifier', null, true], ['subject', 'String', 300, true], ['firstname', 'String', 50, true],
      ['lastname', 'String', 50, true], ['emailaddress1', 'String', 100, true], ['companyname', 'String', 100, true],
      ['jobtitle', 'String', 100, true], ['description', 'Memo', 2000, true], ['leadqualitycode', 'Picklist', null, true],
      ['leadsourcecode', 'Picklist', null, true], ['statecode', 'State', null, true], ['statuscode', 'Status', null, true],
      ['createdon', 'DateTime', null, false], ['modifiedon', 'DateTime', null, false]
    ],
    // [attribute, referenced table, navigation property]
    lookups: [['parentcontactid', 'contact', 'parentcontactid']],
    duplicateRule: 'emailaddress1'
  },
  list: {
    set: 'lists', key: 'listid', primary: 'listname',
    columns: [
      ['listid', 'Uniqueidentifier', null, true], ['listname', 'String', 128, true], ['type', 'Boolean', null, true],
      ['createdfromcode', 'Picklist', null, true], ['membercount', 'Integer', null, false], ['statecode', 'State', null, true],
      ['createdon', 'DateTime', null, false], ['modifiedon', 'DateTime', null, false]
    ],
    lookups: [],
    duplicateRule: null
  }
};

const BY_SET = Object.fromEntries(Object.entries(TABLES).map(([logical, table]) => [table.set, { logical, ...table }]));

const DEFAULT_TRIGGERS = [
  {
    name: 'msdynmkt_examplesignal_1',
    parameters: [
      'msdynmkt_signalingestiontimestamp', 'msdynmkt_signaltimestamp', 'msdynmkt_signaluserauthid',
      'msdynmkt_profileid', 'msdynmkt_bindingid', 'msdynmkt_itemname'
    ]
  }
];

// ---------------------------------------------------------------- helpers --

class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const isGuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const errorBody = (code, message) => JSON.stringify({ error: { code, message } });
const statusText = { 200: 'OK', 201: 'Created', 204: 'No Content', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 412: 'Precondition Failed', 429: 'Too Many Requests', 500: 'Internal Server Error' };

function column(table, name) {
  const found = table.columns.find(([n]) => n === name);
  return found ? { name: found[0], type: found[1], max: found[2], writable: found[3] } : null;
}

function lookupColumn(table, name) {
  const match = /^_(.+)_value$/.exec(name);
  return match ? table.lookups.find(([attribute]) => attribute === match[1]) : null;
}

// A small OData $filter reader: eq ne gt ge lt le, and, or, not-nested parentheses,
// contains/startswith/endswith, 'text' (quotes doubled), numbers, true, false, null.
function parseFilter(text) {
  const tokens = [];
  const pattern = /\s*(\(|\)|,|'(?:[^']|'')*'|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*)/iy;
  let match;
  let index = 0;
  while (index < text.length) {
    pattern.lastIndex = index;
    match = pattern.exec(text);
    if (!match) {
      if (text.slice(index).trim() === '') break;
      throw new ApiError(400, '0x80060888', `The query parameter $filter is not valid near '${text.slice(index, index + 20)}'.`);
    }
    tokens.push(match[1]);
    index = pattern.lastIndex;
  }

  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const expect = (token) => {
    if (next() !== token) throw new ApiError(400, '0x80060888', `The query parameter $filter is not valid: expected '${token}'.`);
  };
  const value = () => {
    const token = next();
    if (token === undefined) throw new ApiError(400, '0x80060888', 'The query parameter $filter ends early.');
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (token === 'null') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token)) return token.toLowerCase(); // GUIDs are unquoted in OData filters
    if (/^-?\d/.test(token)) return Number(token);
    return { column: token };
  };
  const factor = () => {
    if (peek() === '(') {
      next();
      const inner = or();
      expect(')');
      return inner;
    }
    const name = next();
    if (['contains', 'startswith', 'endswith'].includes(name)) {
      expect('(');
      const field = next();
      expect(',');
      const needle = value();
      expect(')');
      return { fn: name, field, needle };
    }
    const op = next();
    if (!['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(op)) throw new ApiError(400, '0x80060888', `The operator '${op}' is not supported here.`);
    return { op, field: name, operand: value() };
  };
  const and = () => {
    let left = factor();
    while (peek() === 'and') {
      next();
      left = { and: [left, factor()] };
    }
    return left;
  };
  const or = () => {
    let left = and();
    while (peek() === 'or') {
      next();
      left = { or: [left, and()] };
    }
    return left;
  };
  const tree = or();
  if (position < tokens.length) throw new ApiError(400, '0x80060888', `The query parameter $filter is not valid near '${tokens[position]}'.`);
  return tree;
}

function evaluate(node, row, check) {
  if (node.and) return evaluate(node.and[0], row, check) && evaluate(node.and[1], row, check);
  if (node.or) return evaluate(node.or[0], row, check) || evaluate(node.or[1], row, check);
  check(node.field);
  const actual = row[node.field] ?? null;
  if (node.fn) {
    const haystack = String(actual ?? '').toLowerCase();
    const needle = String(node.needle ?? '').toLowerCase();
    return node.fn === 'contains' ? haystack.includes(needle) : node.fn === 'startswith' ? haystack.startsWith(needle) : haystack.endsWith(needle);
  }
  // Dataverse compares text without regard to case.
  const left = typeof actual === 'string' ? actual.toLowerCase() : actual;
  const right = typeof node.operand === 'string' ? node.operand.toLowerCase() : node.operand;
  switch (node.op) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'gt': return left !== null && left > right;
    case 'ge': return left !== null && left >= right;
    case 'lt': return left !== null && left < right;
    default: return left !== null && left <= right;
  }
}

function preferences(header) {
  const found = {};
  for (const part of String(header ?? '').split(',')) {
    const [name, raw] = part.split('=').map((item) => item?.trim());
    if (name) found[name] = raw === undefined ? true : raw.replace(/^"|"$/g, '');
  }
  return found;
}

// ------------------------------------------------------------- the server --

/**
 * Starts the stand-in.
 * @param {{ port?: number, host?: string, triggers?: Array<{ name: string, parameters: string[] }> }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void>, state: object }>}
 */
export async function startDataverseStandin(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const triggers = options.triggers ?? DEFAULT_TRIGGERS;
  const state = {
    tokens: new Set(),
    records: Object.fromEntries(Object.values(TABLES).map((table) => [table.set, new Map()])),
    members: new Map(), // list id -> Set of contact ids
    triggerCalls: [],
    control: { throttle: 0, retryAfter: 5, fail: 0, failStatus: 500 },
    counters: { tokens: 0, api: 0, throttled: 0, batches: 0 },
    recent: [],
    version: 1000
  };
  let origin = '';

  function reset() {
    state.tokens.clear();
    for (const set of Object.keys(state.records)) state.records[set].clear();
    state.members.clear();
    state.triggerCalls.length = 0;
    Object.assign(state.control, { throttle: 0, retryAfter: 5, fail: 0, failStatus: 500 });
    Object.assign(state.counters, { tokens: 0, api: 0, throttled: 0, batches: 0 });
    state.recent.length = 0;
  }

  // ---------------------------------------------------------- records --

  function stamp(table, row, created) {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (created) row.createdon = now;
    row.modifiedon = now;
    if (table.logical === 'contact') row.fullname = [row.firstname, row.lastname].filter(Boolean).join(' ') || null;
    if (table.logical === 'list') row.membercount = state.members.get(row.listid)?.size ?? 0;
    state.version += 1;
    return state.version;
  }

  function present(table, entry, select) {
    const shown = { '@odata.etag': `W/"${entry.version}"` };
    const names = select ?? [...table.columns.map(([name]) => name), ...table.lookups.map(([attribute]) => `_${attribute}_value`)];
    for (const name of names) shown[name] = entry.row[name] ?? null;
    shown[table.key] = entry.row[table.key];
    return shown;
  }

  function readSelect(table, raw) {
    if (!raw) return null;
    const names = raw.split(',').map((name) => name.trim()).filter(Boolean);
    for (const name of names) {
      if (!column(table, name) && !lookupColumn(table, name)) {
        throw new ApiError(400, '0x80060888', `Could not find a property named '${name}' on type 'Microsoft.Dynamics.CRM.${table.logical}'.`);
      }
    }
    return names;
  }

  // Applies a request body to a row, checking it the way Dataverse does.
  function apply(table, row, body, creating) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '0x80048d19', 'The request body must be a JSON object.');
    for (const [name, value] of Object.entries(body)) {
      if (name.startsWith('@odata.')) continue;
      if (name.endsWith('@odata.bind')) {
        const navigation = name.slice(0, -'@odata.bind'.length);
        const lookup = table.lookups.find(([, , property]) => property === navigation);
        if (!lookup) throw new ApiError(400, '0x80060888', `An undeclared property '${navigation}' which only has property annotations in the payload but no property value was found in the payload.`);
        if (value === null) {
          row[`_${lookup[0]}_value`] = null;
          continue;
        }
        const target = /^\/?([a-z_]+)\(([0-9a-f-]{36})\)$/i.exec(String(value));
        const referenced = TABLES[lookup[1]];
        if (!target || target[1] !== referenced.set) throw new ApiError(400, '0x80048d19', `The value of '${name}' is not a reference to ${referenced.set}.`);
        const id = target[2].toLowerCase();
        if (!state.records[referenced.set].has(id)) throw new ApiError(404, '0x80040217', `${lookup[1]} With Id = ${id} Does Not Exist`);
        row[`_${lookup[0]}_value`] = id;
        continue;
      }
      const found = column(table, name);
      if (!found) throw new ApiError(400, '0x80060888', `Could not find a property named '${name}' on type 'Microsoft.Dynamics.CRM.${table.logical}'.`);
      if (!found.writable) continue; // Dataverse ignores read-only columns.
      if (name === table.key) {
        if (!creating) continue;
        if (!isGuid(String(value))) throw new ApiError(400, '0x80048d19', `'${value}' is not a valid Guid.`);
        row[name] = String(value).toLowerCase();
        continue;
      }
      if (value === null) {
        row[name] = null;
        continue;
      }
      const wants = { String: 'string', Memo: 'string', Boolean: 'boolean', Picklist: 'number', State: 'number', Status: 'number', Integer: 'number', DateTime: 'string' }[found.type];
      if (wants && typeof value !== wants) throw new ApiError(400, '0x80048d19', `Cannot convert the literal '${value}' to the expected type for '${name}'.`);
      if (found.max && value.length > found.max) {
        throw new ApiError(400, '0x80044331', `A validation error occurred. The length of the '${name}' attribute of the '${table.logical}' entity exceeded the maximum allowed length of '${found.max}'.`);
      }
      row[name] = value;
    }
  }

  function duplicateOf(table, row, ignoreId) {
    if (!table.duplicateRule || !row[table.duplicateRule]) return null;
    const wanted = String(row[table.duplicateRule]).toLowerCase();
    for (const [id, entry] of state.records[table.set]) {
      if (id !== ignoreId && entry.row.statecode === 0 && String(entry.row[table.duplicateRule] ?? '').toLowerCase() === wanted) return id;
    }
    return null;
  }

  function create(table, body, headers) {
    const row = { statecode: 0, statuscode: 1 };
    if (table.logical === 'list') Object.assign(row, { type: false, createdfromcode: 2 });
    apply(table, row, body, true);
    const id = row[table.key] ?? randomUUID();
    row[table.key] = id;
    if (state.records[table.set].has(id)) throw new ApiError(412, '0x80040237', 'A record with matching key values already exists.');
    if (String(headers['mscrm.suppressduplicatedetection'] ?? '').toLowerCase() === 'false' && duplicateOf(table, row, id)) {
      throw new ApiError(412, '0x80040333', 'A record was not created or updated because a duplicate of the current record already exists.');
    }
    const version = stamp(table, row, true);
    state.records[table.set].set(id, { row, version });
    return { id, entry: state.records[table.set].get(id) };
  }

  // ------------------------------------------------------- the Web API --

  function respond(status, body, headers = {}) {
    return { status, body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), headers };
  }

  function entityId(table, id) {
    return `${origin}${API}${table.set}(${id})`;
  }

  // One Web API request, already authenticated; shared by direct calls and $batch parts.
  function handle(method, rawPath, headers, bodyText) {
    const url = new URL(rawPath, `${origin}${API}`);
    if (!url.pathname.startsWith(API)) throw new ApiError(404, '0x8006088a', `Resource not found for the segment '${url.pathname}'.`);
    const path = decodeURIComponent(url.pathname.slice(API.length));
    const query = url.searchParams;
    const prefer = preferences(headers.prefer);
    const writing = method !== 'GET';

    if (writing && state.control.fail > 0) {
      state.control.fail -= 1;
      throw new ApiError(state.control.failStatus, '0x80040216', 'An unexpected error occurred (forced by the stand-in).');
    }

    let body = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new ApiError(400, '0x80048d19', 'The request body is not valid JSON.');
      }
    }

    // Organisation calls.
    if (method === 'GET' && path === 'WhoAmI') {
      return respond(200, { '@odata.context': `${origin}${API}$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse`, BusinessUnitId: '00000000-0000-0000-0000-0000000000b1', UserId: '00000000-0000-0000-0000-0000000000a1', OrganizationId: '00000000-0000-0000-0000-0000000000c1' });
    }
    if (method === 'GET' && path === 'RetrieveVersion()') return respond(200, { Version: '9.2.0.0' });

    // Metadata.
    if (method === 'GET' && path === 'EntityDefinitions') {
      const filter = query.get('$filter') ? parseFilter(query.get('$filter')) : null;
      const rows = Object.entries(TABLES)
        .map(([logical, table]) => ({ LogicalName: logical, EntitySetName: table.set, PrimaryIdAttribute: table.key, PrimaryNameAttribute: table.primary }))
        .filter((row) => !filter || evaluate(filter, row, () => {}));
      return respond(200, { value: rows });
    }
    const definition = /^EntityDefinitions\(LogicalName='([a-z_]+)'\)(?:\/(Attributes|ManyToOneRelationships)(?:\/Microsoft\.Dynamics\.CRM\.(StringAttributeMetadata|MemoAttributeMetadata))?)?$/.exec(path);
    if (method === 'GET' && definition) {
      const table = TABLES[definition[1]];
      if (!table) throw new ApiError(404, '0x80040217', `Could not find an entity with name '${definition[1]}'.`);
      if (!definition[2]) return respond(200, { LogicalName: definition[1], EntitySetName: table.set, PrimaryIdAttribute: table.key, PrimaryNameAttribute: table.primary });
      if (definition[2] === 'ManyToOneRelationships') {
        return respond(200, { value: table.lookups.map(([attribute, referenced, navigation]) => ({ ReferencingAttribute: attribute, ReferencedEntity: referenced, ReferencingEntityNavigationPropertyName: navigation })) });
      }
      const castType = definition[3] === 'MemoAttributeMetadata' ? 'Memo' : definition[3] ? 'String' : null;
      const attributes = [
        ...table.columns.map(([name, type, max, writable]) => ({ name, type, max, writable })),
        ...table.lookups.map(([attribute]) => ({ name: attribute, type: 'Lookup', max: null, writable: true }))
      ];
      return respond(200, {
        value: attributes
          .filter((attribute) => !castType || attribute.type === castType)
          .map((attribute) => ({
            LogicalName: attribute.name,
            AttributeType: attribute.type,
            IsValidForCreate: attribute.writable,
            IsValidForUpdate: attribute.writable && attribute.name !== table.key,
            AttributeOf: null,
            DisplayName: { UserLocalizedLabel: { Label: attribute.name } },
            ...(castType ? { MaxLength: attribute.max } : {})
          }))
      });
    }

    // Custom triggers: unbound actions named after their custom API.
    const trigger = triggers.find((one) => one.name === path);
    if (trigger) {
      if (method !== 'POST') throw new ApiError(405, '0x80060888', 'The action must be called with POST.');
      const missing = trigger.parameters.filter((name) => body?.[name] === undefined || body?.[name] === null);
      if (missing.length > 0) throw new ApiError(400, '0x80040203', `Required parameter(s) missing: ${missing.join(', ')}.`);
      const unknown = Object.keys(body ?? {}).filter((name) => !trigger.parameters.includes(name));
      if (unknown.length > 0) throw new ApiError(400, '0x80060888', `The parameter '${unknown[0]}' in the request payload is not a valid parameter for the operation '${trigger.name}'.`);
      state.triggerCalls.push({ name: trigger.name, body, atUtc: new Date().toISOString() });
      return respond(204);
    }

    // List members.
    const membersPath = /^lists\(([0-9a-f-]{36})\)\/listcontact_association$/i.exec(path);
    if (method === 'GET' && membersPath) {
      const listId = membersPath[1].toLowerCase();
      if (!state.records.lists.has(listId)) throw new ApiError(404, '0x80040217', `list With Id = ${listId} Does Not Exist`);
      const contacts = TABLES.contact;
      const rows = [...(state.members.get(listId) ?? [])].map((id) => state.records.contacts.get(id)).filter(Boolean);
      return page(contacts, rows, query, prefer, url);
    }

    // Tables.
    const single = /^([a-z_]+)\(([0-9a-f-]{36})\)$/i.exec(path);
    const table = BY_SET[single ? single[1] : path];
    if (!table) throw new ApiError(404, '0x8006088a', `Resource not found for the segment '${path.split('(')[0]}'.`);

    if (!single) {
      if (method === 'GET') return page(table, [...state.records[table.set].values()], query, prefer, url);
      if (method === 'POST') {
        const { id, entry } = create(table, body, headers);
        if (prefer.return === 'representation') return respond(201, present(table, entry, readSelect(table, query.get('$select'))), { 'OData-EntityId': entityId(table, id) });
        return respond(204, undefined, { 'OData-EntityId': entityId(table, id) });
      }
      throw new ApiError(405, '0x80060888', `${method} is not supported on a collection.`);
    }

    const id = single[2].toLowerCase();
    const existing = state.records[table.set].get(id);
    const ifMatch = headers['if-match'];
    const ifNoneMatch = headers['if-none-match'];

    if (method === 'GET') {
      if (!existing) throw new ApiError(404, '0x80040217', `${table.logical} With Id = ${id} Does Not Exist`);
      if (ifNoneMatch && ifNoneMatch !== 'null' && ifNoneMatch === `W/"${existing.version}"`) return respond(304, undefined, { ETag: ifNoneMatch });
      return respond(200, present(table, existing, readSelect(table, query.get('$select'))), { ETag: `W/"${existing.version}"` });
    }

    if (method === 'DELETE') {
      if (!existing) throw new ApiError(404, '0x80040217', `${table.logical} With Id = ${id} Does Not Exist`);
      if (ifMatch && ifMatch !== '*' && ifMatch !== `W/"${existing.version}"`) throw new ApiError(412, '0x80060882', "The version of the existing record doesn't match the RowVersion property provided.");
      state.records[table.set].delete(id);
      for (const members of state.members.values()) members.delete(id);
      return respond(204);
    }

    if (method === 'PATCH') {
      // Limit upsert: If-None-Match: * creates only, If-Match: * updates only, an ETag checks the version.
      if (ifNoneMatch === '*' && existing) throw new ApiError(412, '', 'A record with matching key values already exists.');
      if (ifMatch === '*' && !existing) throw new ApiError(404, '0x80040217', `${table.logical} With Id = ${id} Does Not Exist`);
      if (ifMatch && ifMatch !== '*') {
        if (!existing) throw new ApiError(404, '0x80040217', `${table.logical} With Id = ${id} Does Not Exist`);
        if (ifMatch !== `W/"${existing.version}"`) throw new ApiError(412, '0x80060882', "The version of the existing record doesn't match the RowVersion property provided.");
      }
      if (!existing) {
        const { entry } = create(table, { ...body, [table.key]: id }, headers);
        if (prefer.return === 'representation') return respond(201, present(table, entry, readSelect(table, query.get('$select'))), { 'OData-EntityId': entityId(table, id) });
        return respond(204, undefined, { 'OData-EntityId': entityId(table, id) });
      }
      const row = { ...existing.row };
      apply(table, row, body, false);
      // Updates skip duplicate detection unless asked, as the Web API does.
      if (String(headers['mscrm.suppressduplicatedetection'] ?? '').toLowerCase() === 'false' && duplicateOf(table, row, id)) {
        throw new ApiError(412, '0x80040333', 'A record was not created or updated because a duplicate of the current record already exists.');
      }
      const version = stamp(table, row, false);
      state.records[table.set].set(id, { row, version });
      if (prefer.return === 'representation') return respond(200, present(table, state.records[table.set].get(id), readSelect(table, query.get('$select'))), { 'OData-EntityId': entityId(table, id) });
      return respond(204, undefined, { 'OData-EntityId': entityId(table, id) });
    }

    throw new ApiError(405, '0x80060888', `${method} is not supported on a record.`);
  }

  // A page of a collection: $filter, $orderby, $top, Prefer: odata.maxpagesize, @odata.nextLink.
  function page(table, entries, query, prefer, url) {
    const select = readSelect(table, query.get('$select'));
    const check = (name) => {
      if (!column(table, name) && !lookupColumn(table, name)) throw new ApiError(400, '0x80060888', `Could not find a property named '${name}' on type 'Microsoft.Dynamics.CRM.${table.logical}'.`);
    };
    let rows = entries;
    if (query.get('$filter')) {
      const filter = parseFilter(query.get('$filter'));
      rows = rows.filter((entry) => evaluate(filter, entry.row, check));
    }
    const order = (query.get('$orderby') ?? '').split(',').map((part) => part.trim().split(/\s+/)).filter(([name]) => name);
    for (const [name] of order) check(name);
    rows = [...rows].sort((a, b) => {
      for (const [name, direction] of order) {
        const left = a.row[name] ?? '';
        const right = b.row[name] ?? '';
        if (left < right) return direction === 'desc' ? 1 : -1;
        if (left > right) return direction === 'desc' ? -1 : 1;
      }
      return String(a.row[table.key]).localeCompare(String(b.row[table.key]));
    });
    if (query.get('$top')) rows = rows.slice(0, Number(query.get('$top')));

    const size = Math.min(Number(prefer['odata.maxpagesize']) || MAX_PAGE, MAX_PAGE);
    const offset = query.get('$skiptoken') ? Number(Buffer.from(query.get('$skiptoken'), 'base64url').toString()) || 0 : 0;
    const slice = rows.slice(offset, offset + size);
    const result = { '@odata.context': `${origin}${API}$metadata#${table.set}`, value: slice.map((entry) => present(table, entry, select)) };
    if (offset + size < rows.length) {
      const nextUrl = new URL(url.href);
      nextUrl.searchParams.set('$skiptoken', Buffer.from(String(offset + size)).toString('base64url'));
      result['@odata.nextLink'] = nextUrl.href;
    }
    const applied = prefer['odata.maxpagesize'] ? { 'Preference-Applied': `odata.maxpagesize=${size}` } : {};
    return respond(200, result, applied);
  }

  // --------------------------------------------------------------- $batch --

  function parseHttpPart(text) {
    const normalised = text.replace(/\r\n/g, '\n');
    const split = normalised.indexOf('\n\n');
    const head = split < 0 ? normalised : normalised.slice(0, split);
    const body = split < 0 ? '' : normalised.slice(split + 2).trim();
    const [requestLine, ...headerLines] = head.split('\n');
    const [method, target] = requestLine.trim().split(' ');
    const headers = {};
    for (const line of headerLines) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { method, target, headers, body };
  }

  function partsOf(body, boundary) {
    return body.split(`--${boundary}`).map((chunk) => chunk.replace(/^\r?\n/, '')).filter((chunk) => chunk.trim() !== '' && !chunk.startsWith('--'));
  }

  function headersAndContent(part) {
    const normalised = part.replace(/\r\n/g, '\n');
    const split = normalised.indexOf('\n\n');
    const headers = {};
    for (const line of normalised.slice(0, split < 0 ? undefined : split).split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { headers, content: split < 0 ? '' : normalised.slice(split + 2) };
  }

  const boundaryOf = (contentType) => /boundary=("?)([^";]+)\1/i.exec(contentType ?? '')?.[2];

  function httpResponseText(result) {
    const lines = [`HTTP/1.1 ${result.status} ${statusText[result.status] ?? ''}`.trimEnd()];
    if (result.body) lines.push('Content-Type: application/json; odata.metadata=minimal');
    for (const [name, value] of Object.entries(result.headers ?? {})) lines.push(`${name}: ${value}`);
    lines.push('OData-Version: 4.0', '', result.body ?? '');
    return lines.join('\r\n');
  }

  function runOne(part) {
    const request = parseHttpPart(part);
    try {
      return handle(request.method, request.target, request.headers, request.body);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      return respond(failure.status, errorBody(failure.code, failure.message), failure.headers);
    }
  }

  function snapshot() {
    return {
      records: Object.fromEntries(Object.entries(state.records).map(([set, map]) => [set, new Map([...map].map(([id, entry]) => [id, { row: { ...entry.row }, version: entry.version }]))])),
      calls: state.triggerCalls.length
    };
  }

  function restore(saved) {
    for (const [set, map] of Object.entries(saved.records)) state.records[set] = map;
    state.triggerCalls.length = saved.calls;
  }

  function batch(headers, body) {
    state.counters.batches += 1;
    const boundary = boundaryOf(headers['content-type']);
    if (!boundary) throw new ApiError(400, '0x80048d19', 'A $batch request needs a multipart/mixed Content-Type with a boundary.');
    const continueOnError = preferences(headers.prefer)['odata.continue-on-error'] !== undefined;
    const responseBoundary = `batchresponse_${randomUUID()}`;
    const out = [];
    let failedStatus = null;

    for (const part of partsOf(body, boundary)) {
      const { headers: partHeaders, content } = headersAndContent(part);
      const nested = boundaryOf(partHeaders['content-type']);
      if (nested) {
        // A change set: all or nothing.
        const saved = snapshot();
        const results = [];
        let failed = null;
        for (const inner of partsOf(content, nested)) {
          const result = runOne(headersAndContent(inner).content);
          results.push(result);
          if (result.status >= 400) {
            failed = result;
            break;
          }
        }
        if (failed) restore(saved);
        const changesetBoundary = `changesetresponse_${randomUUID()}`;
        const shown = failed ? [failed] : results;
        out.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}\r\n\r\n${shown.map((result) => `--${changesetBoundary}\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n${httpResponseText(result)}\r\n`).join('')}--${changesetBoundary}--`);
        if (failed && !continueOnError) {
          failedStatus = failed.status;
          break;
        }
        continue;
      }
      const result = runOne(content);
      out.push(`Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n${httpResponseText(result)}`);
      if (result.status >= 400 && !continueOnError) {
        failedStatus = result.status;
        break;
      }
    }

    const text = `${out.map((part) => `--${responseBoundary}\r\n${part}\r\n`).join('')}--${responseBoundary}--\r\n`;
    // Without odata.continue-on-error the batch stops at the first failure and carries its status.
    return { status: failedStatus ?? 200, body: text, headers: { 'Content-Type': `multipart/mixed; boundary=${responseBoundary}` } };
  }

  // ----------------------------------------------------------- controls --

  function seed(body) {
    for (const [set, rows] of Object.entries(body ?? {})) {
      const table = BY_SET[set];
      if (!table) throw new ApiError(400, '', `Unknown entity set '${set}'.`);
      for (const raw of rows) {
        const { members, ...fields } = raw;
        const { id } = create(table, fields, {});
        if (set === 'lists' && Array.isArray(members)) {
          state.members.set(id, new Set(members.map((member) => String(member).toLowerCase())));
          state.records.lists.get(id).row.membercount = members.length;
        }
      }
    }
  }

  function snapshotState() {
    return {
      records: Object.fromEntries(Object.entries(state.records).map(([set, map]) => [set, [...map.values()].map((entry) => entry.row)])),
      members: Object.fromEntries([...state.members].map(([id, set]) => [id, [...set]])),
      triggerCalls: state.triggerCalls,
      counters: state.counters,
      control: state.control,
      recent: state.recent
    };
  }

  // ------------------------------------------------------------- routing --

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const url = new URL(request.url, origin);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]));

    const send = (status, body, extra = {}) => {
      const isJson = body !== undefined && typeof body !== 'string';
      const text = body === undefined ? '' : isJson ? JSON.stringify(body) : body;
      const contentType = extra['Content-Type'] ?? (text ? (isJson || text.startsWith('{') ? 'application/json; odata.metadata=minimal' : 'text/html; charset=utf-8') : undefined);
      response.writeHead(status, { 'OData-Version': '4.0', ...(contentType ? { 'Content-Type': contentType } : {}), ...extra });
      response.end(text);
      state.recent.push({ method: request.method, path: url.pathname, status });
      if (state.recent.length > 100) state.recent.shift();
    };

    try {
      // Controls.
      if (url.pathname.startsWith('/_standin/')) {
        const what = url.pathname.slice('/_standin/'.length);
        if (request.method === 'GET' && what === 'state') return send(200, snapshotState());
        if (request.method === 'POST' && what === 'reset') { reset(); return send(204); }
        if (request.method === 'POST' && what === 'expire-tokens') { state.tokens.clear(); return send(204); }
        if (request.method === 'POST' && what === 'throttle') {
          state.control.throttle = Number(url.searchParams.get('times') ?? 1);
          state.control.retryAfter = Number(url.searchParams.get('retryAfter') ?? 5);
          return send(204);
        }
        if (request.method === 'POST' && what === 'fail') {
          state.control.fail = Number(url.searchParams.get('times') ?? 1);
          state.control.failStatus = Number(url.searchParams.get('status') ?? 500);
          return send(204);
        }
        if (request.method === 'POST' && what === 'seed') { seed(bodyText ? JSON.parse(bodyText) : {}); return send(204); }
        return send(404, { error: { code: '', message: `Unknown control '${what}'.` } });
      }

      // Entra ID's token endpoint.
      const tokenPath = /^\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(url.pathname);
      if (tokenPath && request.method === 'POST') {
        const form = new URLSearchParams(bodyText);
        if (form.get('grant_type') !== 'client_credentials') return send(400, { error: 'unsupported_grant_type', error_description: 'AADSTS70003: The app requested an unsupported grant type.' });
        if (!form.get('client_id')) return send(400, { error: 'invalid_request', error_description: "AADSTS900144: The request body must contain the following parameter: 'client_id'." });
        if (!String(form.get('scope') ?? '').endsWith('/.default')) return send(400, { error: 'invalid_scope', error_description: 'AADSTS1002012: The provided value for scope is not valid. Client credential flows must have a scope value with /.default suffixed to the resource identifier.' });
        const secret = form.get('client_secret');
        const assertion = form.get('client_assertion');
        if ((!secret && !assertion) || secret === 'wrong') return send(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
        const token = `standin.${randomUUID()}`;
        state.tokens.add(token);
        state.counters.tokens += 1;
        return send(200, { token_type: 'Bearer', expires_in: 3599, ext_expires_in: 3599, access_token: token });
      }

      // "Open in Dynamics".
      if (url.pathname === '/main.aspx' && request.method === 'GET') {
        const table = TABLES[url.searchParams.get('etn') ?? ''];
        const id = (url.searchParams.get('id') ?? '').replace(/[{}]/g, '').toLowerCase();
        const entry = table && state.records[table.set].get(id);
        const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
        return send(entry ? 200 : 404, `<!doctype html><title>${escape(url.searchParams.get('etn') ?? '')}</title><pre>${escape(JSON.stringify(entry?.row ?? 'Record not found', null, 2))}</pre>`);
      }

      if (!url.pathname.startsWith(API)) return send(404, { error: { code: '', message: 'Not found.' } });

      // The Web API: bearer token, then service protection, then the request.
      const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1];
      if (!bearer || !state.tokens.has(bearer)) return send(401, '', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      state.counters.api += 1;
      if (state.control.throttle > 0) {
        state.control.throttle -= 1;
        state.counters.throttled += 1;
        return send(429, { error: { code: '0x80072322', message: 'Number of requests exceeded the limit of 6000 over time window of 300 seconds.' } }, { 'Retry-After': String(state.control.retryAfter) });
      }

      if (url.pathname === `${API}$batch` && request.method === 'POST') {
        const result = batch(headers, bodyText);
        return send(result.status, result.body, result.headers);
      }

      const result = handle(request.method, url.pathname.slice(API.length) + url.search, headers, bodyText);
      return send(result.status, result.body || undefined, result.headers);
    } catch (failure) {
      if (failure instanceof ApiError) return send(failure.status, { error: { code: failure.code, message: failure.message } }, failure.headers);
      return send(500, { error: { code: '0x80040216', message: String(failure?.message ?? failure) } });
    }
  });

  await new Promise((resolve) => server.listen(options.port ?? 5096, host, resolve));
  origin = `http://${host}:${server.address().port}`;

  return {
    url: origin,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

// Run directly: node tests/standins/dataverse.mjs [port]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? 5096);
  const standin = await startDataverseStandin({ port });
  console.log(`Dataverse stand-in on ${standin.url} (Web API ${standin.url}${API}, controls ${standin.url}/_standin/state)`);
}
