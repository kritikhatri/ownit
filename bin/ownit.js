#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { extractAll } = require('../src/extract.js');
const { gradeAnswer } = require('../src/grade.js');

const PASTE_GAP_MS = 100;

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

function formatGrade({ score, right, missed, wrong, followUpQuestion }) {
  const section = (title, items) => [
    `${title}:`,
    ...(items.length ? items.map((item) => `  - ${item}`) : ['  (none)']),
    '',
  ];
  return [
    `Score: ${score}/100`,
    '',
    ...section('What you got right', right),
    ...section('What you missed', missed),
    ...section('What you got wrong', wrong),
    `Follow-up question: ${followUpQuestion}`,
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

  console.log('\nGrading...\n');
  try {
    const grade = await gradeAnswer({
      ...choice,
      answer,
      apiKey,
      model: process.env.GEMINI_MODEL || undefined,
    });
    console.log(formatGrade(grade));
  } catch (error) {
    console.error(`ownit: ${error.message}`);
    return 1;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
