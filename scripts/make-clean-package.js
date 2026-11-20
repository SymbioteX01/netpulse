#!/usr/bin/env node
/*
 * make-clean-package.js - build a shareable copy of the project with NO private
 * data. It COPIES files; it never deletes or edits the originals.
 *
 * Excluded from the copy: node_modules/, data/, reports/, Surveys/, backups/,
 * fixtures/private/, dist-clean/ and .git/. The copy gets fresh empty
 * data/surveys.json and data/history.json ([]).
 *
 * Usage:
 *   node scripts/make-clean-package.js           (fails if dist-clean exists)
 *   node scripts/make-clean-package.js --force   (removes ONLY dist-clean/ first)
 *   NETPULSE_CLEAN_OUT=<dir> ...                 (write somewhere else; used by tests)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'dist-clean');
// Directory names skipped anywhere in the tree.
const EXCLUDE_DIRS = new Set(['node_modules', 'data', 'reports', 'Surveys', 'backups', 'dist-clean', '.git']);
// Paths (relative to the source root) skipped; needed because the private
// directory must be excluded by PATH, not by the generic name "private".
const EXCLUDE_RELS = new Set([path.join('fixtures', 'private')]);

function copyTree(srcDir, dstDir, relBase) {
  relBase = relBase || '';
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (EXCLUDE_RELS.has(rel)) continue;
      fs.mkdirSync(path.join(dstDir, entry.name), { recursive: true });
      copyTree(path.join(srcDir, entry.name), path.join(dstDir, entry.name), rel);
    } else if (entry.isFile()) {
      fs.copyFileSync(path.join(srcDir, entry.name), path.join(dstDir, entry.name));
    }
  }
}

function buildCleanPackage(srcRoot, outDir, opts) {
  opts = opts || {};
  if (fs.existsSync(outDir)) {
    if (!opts.force) throw new Error(outDir + ' already exists. Remove it yourself, or pass force (removes ONLY that directory).');
    // Only the tool-generated output directory is ever removed.
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  copyTree(srcRoot, outDir);
  fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data', 'surveys.json'), '[]\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'data', 'history.json'), '[]\n', 'utf8');
  return outDir;
}

if (require.main === module) {
  const OUT = process.env.NETPULSE_CLEAN_OUT ? path.resolve(process.env.NETPULSE_CLEAN_OUT) : DEFAULT_OUT;
  try {
    buildCleanPackage(ROOT, OUT, { force: process.argv.includes('--force') });
    console.log('Clean package written to ' + OUT);
    console.log('Private data (data/, reports/, Surveys/, backups/, fixtures/private/) was NOT copied.');
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}

module.exports = { buildCleanPackage, copyTree, EXCLUDE_DIRS, EXCLUDE_RELS, DEFAULT_OUT };
