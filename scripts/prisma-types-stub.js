/**
 * Prisma's binary host is blocked by the egress policy here, so `prisma
 * generate` cannot run and @prisma/client has no types. Without them tsc
 * fails on every file that touches the database, which hides real errors
 * (a syntax error in an import block shipped to production this way).
 *
 * This writes a permissive type-only stand-in, derived from schema.prisma,
 * so tsc can check everything else. It is a verification aid inside the
 * throwaway container copy and is never committed or deployed — Railway
 * runs the real `prisma generate`.
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

const names = new Set(['Prisma', 'PrismaClient']);
for (const m of schema.matchAll(/^\s*(?:model|enum|type)\s+(\w+)/gm)) names.add(m[1]);

const lines = [
  '// Generated stand-in for verification only. Not committed, not deployed.',
  'export declare class PrismaClient {',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  'export declare const Prisma: any;',
  'export declare namespace Prisma {',
  '  type TransactionClient = any;',
  '  type JsonValue = any;',
  '  type InputJsonValue = any;',
  '  type JsonObject = any;',
  '}',
];

for (const n of names) {
  if (n === 'Prisma' || n === 'PrismaClient') continue;
  lines.push(`export type ${n} = any;`);
  lines.push(`export declare const ${n}: any;`);
}

const dir = path.join(root, 'node_modules/@prisma/client');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.d.ts'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify({ name: '@prisma/client', version: '0.0.0-stub', main: 'index.js', types: 'index.d.ts' }, null, 2),
);
fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = new Proxy({}, { get: () => function () {} });\n');

console.log(`stub written for ${names.size} Prisma names`);
