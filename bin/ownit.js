#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const readline = require('node:readline');
const { extractAll } = require('../src/extract.js');
const { GREEN, YELLOW, RED, paint, formatBar } = require('../src/format.js');
const { gradeAnswer, gradeFollowUp } = require('../src/grade.js');
const { summarizeFiles, formatMap, renderHtml } = require('../src/map.js');
const { gitPaths, loadScores, saveScore } = require('../src/scores.js');

const PASTE_GAP_MS = 100;
const USAGE = 'Usage: ownit | ownit map [--html]';

function formatFunction({ file, startLine, endLine, code }) {
  const width = String(endLine).length;
  const numbered = code
    .split('\n')
    .map((line, index) => `${String(startLine + index).padStart(width)} | ${line}`);
  return [`${file}:${startLine}`, '', ...numbered].join('\n');
}

// Reads lines until Enter is pressed on an empty line, or until end of input.
// A paste delivers all its lines at once, so a blank line only finishes the
// answer if nothing follows it within PASTE_GAP_MS.
function readAnswer() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const lines = [];
    let timer;

    rl.on('line', (line) => {
      clearTimeout(timer);
      if (line.trim() !== '') {
        lines.push(line);
      } else if (lines.length > 0) {
        lines.push(line);
        timer = setTimeout(() => rl.close(), PASTE_GAP_MS);
      }
    });
    rl.on('SIGINT', () => {
      rl.close();
      process.exit(130);
    });
    rl.on('close', () => {
      clearTimeout(timer);
      resolve(lines.join('\n').trimEnd());
    });
    rl.prompt();
  });
}

function formatScore(score) {
  return `${formatBar(score)} ${score}/100`;
}

function formatGrade({ score, right, missed, wrong }) {
  const items = (color, symbol, entries) => entries.map((entry) => `${paint(color, symbol)} ${entry}`);
  return [
    formatScore(score),
    '',
    ...items(GREEN, '✓', right),
    ...items(YELLOW, '●', missed),
    ...items(RED, '✗', wrong),
  ].join('\n');
}

function describeError(error) {
  if (error.code === 'ENOENT' && error.syscall && error.syscall.startsWith('spawn')) {
    return 'git is not installed or not on your PATH.';
  }
  if (error.status !== undefined) return 'this command must be run inside a Git repository.';
  return error.message;
}

function showMap(html) {
  const { gitDir, root } = gitPaths();
  const files = [...new Set(extractAll(root).map(({ file }) => file))];
  const rows = summarizeFiles(files, loadScores(gitDir));
  if (html) {
    const output = path.join(gitDir, 'ownit-map.html');
    fs.writeFileSync(output, renderHtml(rows, path.basename(root)));
    console.log(`Created ${pathToFileURL(output)}`);
  } else {
    console.log(formatMap(rows));
  }
  return 0;
}

async function quiz() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ownit: set the GEMINI_API_KEY environment variable first.');
    return 1;
  }

  const { gitDir, prefix } = gitPaths();
  const functions = extractAll();

  if (functions.length === 0) {
    console.error('ownit: no JavaScript or Python functions of 4 to 120 lines found in tracked files.');
    return 1;
  }

  const choice = functions[Math.floor(Math.random() * functions.length)];
  console.log(formatFunction(choice));
  console.log('\nExplain what this function does.');
  console.log('(Press Enter on an empty line to finish.)\n');

  const answer = await readAnswer();
  if (answer === '') {
    console.error('ownit: no answer given.');
    return 1;
  }

  const model = process.env.GEMINI_MODEL || undefined;
  console.log('\nGrading...\n');
  const grade = await gradeAnswer({ ...choice, answer, apiKey, model });
  // Saved now so quitting during the follow-up still keeps this score.
  const entry = {
    id: crypto.randomUUID(),
    file: prefix + choice.file,
    function: choice.name,
    startLine: choice.startLine,
    endLine: choice.endLine,
    score: grade.score,
    firstScore: grade.score,
    followUpChange: null,
    date: new Date().toISOString(),
  };
  saveScore(gitDir, entry);
  console.log(formatGrade(grade));

  console.log(`\nFollow-up: ${grade.followUpQuestion}`);
  console.log('(Press Enter on an empty line to finish.)\n');
  const followUpAnswer = await readAnswer();
  if (followUpAnswer === '') {
    console.log(`\nNo follow-up answer, so your score stays the same.\n\n${formatScore(grade.score)}`);
    return 0;
  }

  console.log('\nGrading...\n');
  const { pointsChange, feedback } = await gradeFollowUp({
    ...choice,
    question: grade.followUpQuestion,
    answer: followUpAnswer,
    apiKey,
    model,
  });
  const finalScore = Math.min(100, Math.max(0, grade.score + pointsChange));
  saveScore(gitDir, { ...entry, score: finalScore, followUpChange: pointsChange });
  const change = pointsChange > 0
    ? paint(GREEN, `+${pointsChange} points`)
    : pointsChange < 0 ? paint(RED, `${pointsChange} points`) : '0 points';
  console.log(`${change}: ${feedback}\n\n${formatScore(finalScore)}`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args.length === 0) return await quiz();
    if (args[0] === 'map' && args.length === 1) return showMap(false);
    if (args[0] === 'map' && args.length === 2 && args[1] === '--html') return showMap(true);
  } catch (error) {
    console.error(`ownit: ${describeError(error)}`);
    return 1;
  }
  console.error(USAGE);
  return 1;
}

main().then((code) => {
  process.exitCode = code;
});
