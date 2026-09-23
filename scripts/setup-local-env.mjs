import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);
let text = readFileSync(existsSync(path) ? path : example, 'utf8');
const current = /^SESSION_SECRET=(.*)$/m.exec(text)?.[1]?.trim();
if (!current || current.startsWith('replace-')) {
  const line = 'SESSION_SECRET=' + randomBytes(48).toString('base64url');
  text = /^SESSION_SECRET=.*$/m.test(text) ? text.replace(/^SESSION_SECRET=.*$/m, line) : text + '\n' + line + '\n';
}
if (!/^AUTH_TEST_DATABASE_URL=/m.test(text)) text += '\nAUTH_TEST_DATABASE_URL=postgresql://dtp_test:dtp_test_only@127.0.0.1:5434/dhaka_tesla_auth_test\n';
writeFileSync(path, text);
console.log('Local .env ready; existing settings and non-placeholder session secret preserved.');
