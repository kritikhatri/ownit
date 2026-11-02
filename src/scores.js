'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCORES_FILE = 'ownit-scores.json';

function gitPaths(cwd = process.cwd()) {
  const output = execFileSync('git', ['rev-parse', '--absolute-git-dir', '--show-toplevel', '--show-prefix'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [gitDir, root, prefix] = output.split('\n');
  return { gitDir, root, prefix };
}

function loadScores(gitDir) {
  const file = path.join(gitDir, SCORES_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  // Stop rather than treat a damaged file as empty, which would overwrite the history.
  try {
    const { scores } = JSON.parse(text);
    if (Array.isArray(scores)) return scores;
  } catch {
    // Reported below.
  }
  throw new Error(`${file} is damaged. Fix or remove it to continue.`);
}

// Writes to a temporary file first, so an interrupted save can't damage the history.
function writeScores(gitDir, scores) {
  const file = path.join(gitDir, SCORES_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, scores }, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

// Adds a score, or replaces the entry with the same id when a follow-up changes it.
function saveScore(gitDir, entry) {
  const scores = loadScores(gitDir);
  const index = scores.findIndex((existing) => existing.id === entry.id);
  if (index === -1) scores.push(entry);
  else scores[index] = entry;
  writeScores(gitDir, scores);
}

module.exports = { gitPaths, loadScores, saveScore };
