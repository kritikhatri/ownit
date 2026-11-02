#!/usr/bin/env node
'use strict';

const { extractAll } = require('../src/extract.js');

function formatFunction({ file, startLine, endLine, code }) {
  const width = String(endLine).length;
  const numbered = code
    .split('\n')
    .map((line, index) => `${String(startLine + index).padStart(width)} | ${line}`);
  return [`${file}:${startLine}`, '', ...numbered].join('\n');
}

function main() {
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
  return 0;
}

process.exitCode = main();
