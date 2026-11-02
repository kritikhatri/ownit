#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { extractAll } = require('../src/extract.js');
const { gradeAnswer, gradeFollowUp } = require('../src/grade.js');

const PASTE_GAP_MS = 100;
const BAR_WIDTH = 20;
const COLOR_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

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

function paint(color, text) {
  return COLOR_ENABLED ? `${color}${text}${RESET}` : text;
}

function formatScore(score) {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  const color = score >= 80 ? GREEN : score >= 50 ? YELLOW : RED;
  const bar = paint(color, '█'.repeat(filled)) + '░'.repeat(BAR_WIDTH - filled);
  return `${bar} ${score}/100`;
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

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ownit: set the GEMINI_API_KEY environment variable first.');
    return 1;
  }

  let functions;
  try {
    functions = extractAll();
  } catch (error) {
    if (error.code === 'ENOENT' && error.syscall.startsWith('spawn')) {
      console.error('ownit: git is not installed or not on your PATH.');
    } else if (error.status !== undefined) {
      console.error('ownit: this command must be run inside a Git repository.');
    } else {
      console.error(`ownit: ${error.message}`);
    }
    return 1;
  }

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
  try {
    const grade = await gradeAnswer({ ...choice, answer, apiKey, model });
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
    const change = pointsChange > 0
      ? paint(GREEN, `+${pointsChange} points`)
      : pointsChange < 0 ? paint(RED, `${pointsChange} points`) : '0 points';
    console.log(`${change}: ${feedback}\n\n${formatScore(finalScore)}`);
  } catch (error) {
    console.error(`ownit: ${error.message}`);
    return 1;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
