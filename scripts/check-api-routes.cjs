#!/usr/bin/env node
'use strict';

/**
 * Ensures every `app.(get|post|put|delete)( '/api/...')` in server.js has a matching
 * path+method in `lib/openapi-spec.cjs`, and vice versa (OpenAPI `{param}` vs Express `:param`).
 */

const fs = require('fs');
const path = require('path');
const { buildOpenApiDocument } = require('../lib/openapi-spec.cjs');

function expressPathToOpenAPI(routePath) {
  return String(routePath).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectRoutesFromServer() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  const set = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const p = m[2];
    if (!p.startsWith('/api')) continue;
    set.add(`${method} ${expressPathToOpenAPI(p)}`);
  }
  return set;
}

function collectRoutesFromOpenAPI() {
  const spec = buildOpenApiDocument(null);
  const set = new Set();
  for (const [pathKey, methods] of Object.entries(spec.paths || {})) {
    for (const meth of Object.keys(methods)) {
      if (meth === 'parameters') continue;
      set.add(`${meth.toUpperCase()} ${pathKey}`);
    }
  }
  return set;
}

const fromServer = collectRoutesFromServer();
const fromSpec = collectRoutesFromOpenAPI();

const missingInSpec = [...fromServer].filter((x) => !fromSpec.has(x)).sort();
const extraInSpec = [...fromSpec].filter((x) => !fromServer.has(x)).sort();

if (missingInSpec.length || extraInSpec.length) {
  console.error('OpenAPI route manifest is out of sync with server.js.');
  if (missingInSpec.length) {
    console.error('\nIn server.js but missing from lib/openapi-spec.cjs:');
    missingInSpec.forEach((x) => console.error(' ', x));
  }
  if (extraInSpec.length) {
    console.error('\nIn lib/openapi-spec.cjs but not registered in server.js:');
    extraInSpec.forEach((x) => console.error(' ', x));
  }
  process.exit(1);
}

console.log(`API routes: ${fromServer.size} paths+methods match OpenAPI and server.js.`);
