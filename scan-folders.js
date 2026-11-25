// Tek bir kök klasörü tarar ve JSON yazar. Ana sunucu bunu ayrı süreçte, zaman aşımıyla çalıştırır;
// iCloud/Masaüstü gibi takılabilen klasörler ana sunucuyu kilitleyemez.
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = [];
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.') || e.name.endsWith('.git')) continue;
  const dir = path.join(root, e.name);
  let mtimeMs = 0, hasClaudeMd = false, isGit = false;
  try { mtimeMs = fs.statSync(dir).mtimeMs; } catch {}
  try { hasClaudeMd = fs.existsSync(path.join(dir, 'CLAUDE.md')); } catch {}
  try { isGit = fs.existsSync(path.join(dir, '.git')); } catch {}
  out.push({ dir, name: e.name, mtimeMs, hasClaudeMd, isGit });
}
process.stdout.write(JSON.stringify(out));
