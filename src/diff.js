'use strict';

const { execFileSync } = require('node:child_process');

const MAX_DIFF_CHARS = 100000;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function hasCommits() {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch (error) {
    if (error.status === undefined) throw error;
    git(['rev-parse', '--git-dir']); // Still throws outside a repository.
    return false;
  }
}

// Staged and unstaged changes to tracked files. Untracked files are only
// counted: they could hold secrets, so they aren't sent anywhere until added.
function currentChanges() {
  const base = hasCommits() ? ['HEAD'] : ['--cached'];
  const full = git(['diff', '--no-color', '--no-ext-diff', ...base]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--full-name', ':/'])
    .split('\n')
    .filter(Boolean).length;
  return {
    diff: full.slice(0, MAX_DIFF_CHARS),
    truncated: full.length > MAX_DIFF_CHARS,
    untracked,
  };
}

module.exports = { currentChanges };
