#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const readline = require('node:readline');
const { currentChanges } = require('../src/diff.js');
const { extractAll } = require('../src/extract.js');
const { GREEN, YELLOW, RED, paint, formatBar } = require('../src/format.js');
const { gradeAnswer, gradeChanges, gradeFollowUp, explainSimply } = require('../src/grade.js');
const { summarizeFiles, formatMap, renderHtml } = require('../src/map.js');
const { gitPaths, loadScores, saveScore } = require('../src/scores.js');

const PASTE_GAP_MS = 100;
const USAGE = 'Usage: ownit | ownit map [--html] | ownit diff [--min <0-100>]';

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

function requireApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('set the GEMINI_API_KEY environment variable first.');
  return { apiKey, model: process.env.GEMINI_MODEL || undefined };
}

function askFollowUpPrompt(question) {
  console.log(`\nFollow-up: ${question}`);
  console.log('(Press Enter on an empty line to finish.)\n');
}

// Asks the follow-up and returns the final score. `context` describes the code
// being discussed.
async function runFollowUp(grade, context, gemini) {
  askFollowUpPrompt(grade.followUpQuestion);
  const answer = await readAnswer();
  if (answer === '') {
    console.log(`\nNo follow-up answer, so your score stays the same.\n\n${formatScore(grade.score)}`);
    return { score: grade.score, pointsChange: null };
  }

  console.log('\nGrading...\n');
  const { pointsChange, feedback } = await gradeFollowUp({
    ...context,
    question: grade.followUpQuestion,
    answer,
    ...gemini,
  });
  const score = Math.min(100, Math.max(0, grade.score + pointsChange));
  const change = pointsChange > 0
    ? paint(GREEN, `+${pointsChange} points`)
    : pointsChange < 0 ? paint(RED, `${pointsChange} points`) : '0 points';
  console.log(`${change}: ${feedback}\n\n${formatScore(score)}`);
  return { score, pointsChange };
}

// One question and its grading.
async function runRound(choice, gitInfo, gemini) {
  console.log(formatFunction(choice));
  console.log('\nExplain what this function does.');
  console.log('(Press Enter on an empty line to finish.)\n');

  const answer = await readAnswer();
  if (answer === '') {
    console.log('\nNo answer given, so nothing was scored.');
    return;
  }

  console.log('\nGrading...\n');
  const grade = await gradeAnswer({ ...choice, answer, ...gemini });
  // Saved now so quitting during the follow-up still keeps this score.
  const entry = {
    id: crypto.randomUUID(),
    file: gitInfo.prefix + choice.file,
    function: choice.name,
    startLine: choice.startLine,
    endLine: choice.endLine,
    score: grade.score,
    firstScore: grade.score,
    followUpChange: null,
    date: new Date().toISOString(),
  };
  saveScore(gitInfo.gitDir, entry);
  console.log(formatGrade(grade));

  const { score, pointsChange } = await runFollowUp(grade, choice, gemini);
  saveScore(gitInfo.gitDir, { ...entry, score, followUpChange: pointsChange });
}

function askMenu() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let choice = 'quit';
    rl.on('SIGINT', () => {
      rl.close();
      process.exit(130);
    });
    rl.on('close', () => resolve(choice));
    rl.question('\n[n] Next  [l] Learn  [m] Map  [q] Quit: ', (text) => {
      choice = text.trim().toLowerCase();
      rl.close();
    });
  });
}

// Returns true to play another round, false to quit.
async function runMenu(choice, gemini) {
  let explanation;
  for (;;) {
    const action = await askMenu();
    if (action === 'n' || action === 'next') return true;
    if (action === 'q' || action === 'quit') return false;
    try {
      if (action === 'l' || action === 'learn') {
        if (!explanation) {
          console.log('\nThinking...');
          explanation = await explainSimply({ ...choice, ...gemini });
        }
        console.log(`\n${explanation}`);
      } else if (action === 'm' || action === 'map') {
        console.log('');
        showMap(false);
      } else {
        console.log('Please choose n, l, m or q.');
      }
    } catch (error) {
      // A failed lookup shouldn't end the session.
      console.error(`ownit: ${describeError(error)}`);
    }
  }
}

async function quiz() {
  const gemini = requireApiKey();
  const gitInfo = gitPaths();
  const functions = extractAll();

  if (functions.length === 0) {
    console.error('ownit: no JavaScript or Python functions of 4 to 120 lines found in tracked files.');
    return 1;
  }

  // Avoid repeats until every function has come up once.
  let remaining = [];
  for (;;) {
    if (remaining.length === 0) remaining = [...functions];
    const [choice] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
    await runRound(choice, gitInfo, gemini);
    if (!(await runMenu(choice, gemini))) return 0;
  }
}

function formatDiff(diff) {
  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) return paint(GREEN, line);
      if (line.startsWith('-') && !line.startsWith('---')) return paint(RED, line);
      return line;
    })
    .join('\n');
}

// Exits with 1 when `min` is set and the final score is below it, so this can
// block a commit or a CI step.
async function explainDiff(min) {
  const gemini = requireApiKey();
  const { diff, truncated, untracked } = currentChanges();
  if (diff === '') {
    const note = untracked ? ` (${untracked} untracked, use git add to include them)` : '';
    console.log(`No changes to explain${note}.`);
    return 0;
  }

  console.log(formatDiff(diff));
  if (truncated) console.log('\n(This diff is very large, so only the first part is shown and graded.)');
  if (untracked) console.log(`\n(${untracked} untracked not included; use git add to include them.)`);
  console.log('\nExplain these changes.');
  console.log('(Press Enter on an empty line to finish.)\n');

  const answer = await readAnswer();
  if (answer === '') {
    console.error('ownit: no answer given.');
    return 1;
  }

  console.log('\nGrading...\n');
  const grade = await gradeChanges({ diff, truncated, answer, ...gemini });
  console.log(formatGrade(grade));
  const context = { file: '(uncommitted changes)', name: 'git diff', code: diff };
  const { score } = await runFollowUp(grade, context, gemini);

  if (min === null) return 0;
  if (score < min) {
    console.log(`\n${paint(RED, 'Failed')}: ${score} is below the minimum of ${min}.`);
    return 1;
  }
  console.log(`\n${paint(GREEN, 'Passed')}: ${score} meets the minimum of ${min}.`);
  return 0;
}

function parseMin(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== '--min' || !/^\d+$/.test(args[1]) || Number(args[1]) > 100) return undefined;
  return Number(args[1]);
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args.length === 0) return await quiz();
    if (args[0] === 'map' && args.length === 1) return showMap(false);
    if (args[0] === 'map' && args.length === 2 && args[1] === '--html') return showMap(true);
    if (args[0] === 'diff') {
      const min = parseMin(args.slice(1));
      if (min !== undefined) return await explainDiff(min);
    }
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
