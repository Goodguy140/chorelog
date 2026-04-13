#!/usr/bin/env node
'use strict';

/** Writes a static OpenAPI JSON snapshot to `docs/openapi.json` (for browsing in git without running the server). */

const fs = require('fs');
const path = require('path');
const { buildOpenApiDocument } = require('../lib/openapi-spec.cjs');

const dest = path.join(__dirname, '..', 'docs', 'openapi.json');
const doc = buildOpenApiDocument(null);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log('Wrote', path.relative(process.cwd(), dest));
