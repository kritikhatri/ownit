'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MIN_LINES = 4;
const MAX_LINES = 120;

const LANGUAGE_BY_EXTENSION = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_FILE = /(\.(test|spec)\.[cm]?jsx?$)|(^test_.*\.py$)|(_test\.py$)|(^conftest\.py$)/;

const IDENT_CHAR = /[\w$\u0080-￿]/;
const IDENT = '[A-Za-z_$\\u0080-\\uffff][\\w$\\u0080-\\uffff]*';

// A `/` directly after one of these words starts a regex, not a division.
const WORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

// `word(...) {` is a method definition unless the word is one of these.
const NOT_METHOD_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return',
  'await', 'yield', 'typeof', 'new', 'delete', 'void', 'throw', 'super',
]);

function isSkippedPath(filePath) {
  const parts = filePath.split('/');
  const fileName = parts.pop();
  return parts.some((part) => EXCLUDED_DIRS.has(part)) || TEST_FILE.test(fileName);
}

function listSourceFiles(root = process.cwd()) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return output
    .split('\0')
    .filter((file) => file && LANGUAGE_BY_EXTENSION[path.extname(file)] && !isSkippedPath(file));
}

function maskRange(out, from, to) {
  for (let i = from; i < to; i++) {
    if (out[i] !== '\n') out[i] = ' ';
  }
}

// Returns the source with comments, strings and regexes blanked out, so the
// code that looks for functions never sees brackets or keywords inside them.
// Offsets and line numbers match the original.
function maskJavaScript(source) {
  const out = source.split('');
  const n = source.length;
  const templateDepths = [];
  let braceDepth = 0;
  let lastSignificant = '';
  let lastWord = '';
  let i = 0;

  const scanTemplate = () => {
    const start = i;
    while (i < n) {
      if (source[i] === '\\') {
        i += 2;
      } else if (source[i] === '`') {
        i++;
        lastSignificant = '`';
        break;
      } else if (source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        templateDepths.push(braceDepth);
        lastSignificant = '(';
        break;
      } else {
        i++;
      }
    }
    i = Math.min(i, n);
    maskRange(out, start, i);
  };

  const regexEnd = () => {
    let inClass = false;
    for (let j = i + 1; j < n && source[j] !== '\n'; j++) {
      if (source[j] === '\\') j++;
      else if (source[j] === '[') inClass = true;
      else if (source[j] === ']') inClass = false;
      else if (source[j] === '/' && !inClass) {
        j++;
        while (j < n && IDENT_CHAR.test(source[j])) j++;
        return j;
      }
    }
    return -1;
  };

  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      maskRange(out, i, stop);
      i = stop;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      maskRange(out, i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      // An unclosed quote ends at the newline, which also recovers from JSX
      // text such as <p>don't</p>.
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      const stop = Math.min(source[j] === c ? j + 1 : j, n);
      maskRange(out, i, stop);
      i = stop;
      lastSignificant = c;
    } else if (c === '`') {
      i++;
      out[i - 1] = ' ';
      scanTemplate();
    } else if (c === '/') {
      const canStartRegex = lastSignificant === 'word'
        ? WORDS_BEFORE_REGEX.has(lastWord)
        : !')]}"\'`<'.includes(lastSignificant) || lastSignificant === '';
      const end = canStartRegex ? regexEnd() : -1;
      if (end === -1) {
        lastSignificant = '/';
        i++;
      } else {
        maskRange(out, i, end);
        i = end;
        lastSignificant = ')';
      }
    } else if (IDENT_CHAR.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(source[j])) j++;
      lastWord = source.slice(i, j);
      lastSignificant = 'word';
      i = j;
    } else {
      if (c === '{') {
        braceDepth++;
      } else if (c === '}') {
        if (templateDepths.length && templateDepths[templateDepths.length - 1] === braceDepth) {
          templateDepths.pop();
          out[i] = ' ';
          i++;
          scanTemplate();
          continue;
        }
        braceDepth--;
      }
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
  }
  return out.join('');
}

// Comments are blanked. Strings are blanked except the opening quote, which
// keeps the line's indentation visible. `stringLines` records the lines a
// multi-line string continues onto, since those now look empty.
function maskPython(source) {
  const out = source.split('');
  const n = source.length;
  const stringLines = new Set();
  let line = 1;
  let i = 0;

  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '#') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      maskRange(out, i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const triple = source.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < n && !source.startsWith(quote, j) && (triple || source[j] !== '\n')) {
        j += source[j] === '\\' ? 2 : 1;
      }
      const stop = Math.min(source.startsWith(quote, j) ? j + quote.length : j, n);
      maskRange(out, i + 1, stop);
      for (let k = i; k < stop; k++) {
        if (source[k] === '\n') {
          line++;
          stringLines.add(line);
        }
      }
      i = stop;
    } else {
      i++;
    }
  }
  return { masked: out.join(''), stringLines };
}

// Maps each opening and closing bracket offset to its partner's offset.
function matchBrackets(masked) {
  const closers = { ')': '(', ']': '[', '}': '{' };
  const match = new Map();
  const stack = [];
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') {
      stack.push(i);
    } else if (closers[c]) {
      // Drop unclosed openers so one stray bracket can't derail the whole file.
      let top = stack.length - 1;
      while (top >= 0 && masked[stack[top]] !== closers[c]) top--;
      if (top >= 0) {
        match.set(stack[top], i);
        match.set(i, stack[top]);
        stack.length = top;
      }
    }
  }
  return match;
}

function skipSpaceForward(masked, i) {
  while (i < masked.length && /\s/.test(masked[i])) i++;
  return i;
}

function skipSpaceBackward(masked, i) {
  while (i >= 0 && /\s/.test(masked[i])) i--;
  return i;
}

function makeLineLookup(source) {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

// Where the name a function is assigned to begins: `name = fn`, `a.b = fn`, `key: fn`.
function assignedName(masked, start) {
  const before = masked.slice(Math.max(0, start - 200), start);
  const found = new RegExp(`(${IDENT}(?:\\.#?${IDENT})*)\\s*(?:\\|\\|=|&&=|\\?\\?=|=|:)\\s*$`).exec(before);
  return found ? { name: found[1], start: start - before.length + found.index } : null;
}

// Finds the end of an arrow function's expression body, starting after `=>`.
function arrowExpressionEnd(masked, from, match) {
  let i = skipSpaceForward(masked, from);
  let last = i;
  while (i < masked.length) {
    const c = masked[i];
    if (',;)]}'.includes(c)) break;
    if (c === '(' || c === '[' || c === '{') {
      if (!match.has(i)) break;
      i = match.get(i);
      last = i;
    } else if (c === '\n') {
      const next = skipSpaceForward(masked, i);
      const continues = '=+-*/%&|<>?:.^!~'.includes(masked[last]) || '.?:+-*/%&|=<>^'.includes(masked[next] || ' ');
      if (!continues) break;
      i = next - 1;
    } else if (!/\s/.test(c)) {
      last = i;
    }
    i++;
  }
  return last;
}

function findJavaScriptFunctions(source) {
  const masked = maskJavaScript(source);
  const match = matchBrackets(masked);
  const lineOf = makeLineLookup(source);
  const found = [];
  const add = (name, start, end) => {
    found.push({ name, startLine: lineOf(start), endLine: lineOf(end) });
  };

  // function declarations and expressions
  const keyword = new RegExp(`(?<![\\w$.])(async\\s+)?function\\b\\s*\\*?\\s*(${IDENT})?\\s*\\(`, 'g');
  for (const hit of masked.matchAll(keyword)) {
    const paramsOpen = hit.index + hit[0].length - 1;
    const paramsClose = match.get(paramsOpen);
    if (paramsClose === undefined) continue;
    const bodyOpen = skipSpaceForward(masked, paramsClose + 1);
    if (masked[bodyOpen] !== '{' || !match.has(bodyOpen)) continue;
    const assigned = hit[2] ? null : assignedName(masked, hit.index);
    add(hit[2] || (assigned ? assigned.name : '<anonymous>'), assigned ? assigned.start : hit.index, match.get(bodyOpen));
  }

  // arrow functions
  for (const hit of masked.matchAll(/=>/g)) {
    let paramsEnd = skipSpaceBackward(masked, hit.index - 1);
    let start;
    if (masked[paramsEnd] === ')') {
      if (!match.has(paramsEnd)) continue;
      start = match.get(paramsEnd);
    } else {
      start = paramsEnd;
      while (start > 0 && IDENT_CHAR.test(masked[start - 1])) start--;
      if (!IDENT_CHAR.test(masked[paramsEnd])) continue;
    }
    const asyncPrefix = /async\s+$/.exec(masked.slice(Math.max(0, start - 40), start));
    if (asyncPrefix) start -= asyncPrefix[0].length;
    const assigned = assignedName(masked, start);
    if (assigned) start = assigned.start;

    const bodyStart = skipSpaceForward(masked, hit.index + 2);
    const end = masked[bodyStart] === '{'
      ? match.get(bodyStart)
      : arrowExpressionEnd(masked, hit.index + 2, match);
    if (end === undefined) continue;
    add(assigned ? assigned.name : '<anonymous>', start, end);
  }

  // class and object methods: name(...) { ... } and [computed](...) { ... }
  for (const [paramsOpen, paramsClose] of match) {
    if (masked[paramsOpen] !== '(' || paramsClose < paramsOpen) continue;
    const bodyOpen = skipSpaceForward(masked, paramsClose + 1);
    if (masked[bodyOpen] !== '{' || !match.has(bodyOpen)) continue;

    const nameEnd = skipSpaceBackward(masked, paramsOpen - 1);
    let nameStart = nameEnd;
    if (masked[nameEnd] === ']') {
      if (!match.has(nameEnd)) continue;
      nameStart = match.get(nameEnd);
    } else {
      while (nameStart > 0 && IDENT_CHAR.test(masked[nameStart - 1])) nameStart--;
      if (!IDENT_CHAR.test(masked[nameEnd])) continue;
      if (masked[nameStart - 1] === '#') nameStart--;
    }
    const name = source.slice(nameStart, nameEnd + 1);
    if (NOT_METHOD_NAMES.has(name)) continue;

    const before = masked.slice(Math.max(0, nameStart - 60), nameStart);
    if (/(?:\bfunction\s*\*?\s*|\.\s*|\bnew\s+)$/.test(before)) continue;
    const modifiers = /(?:(?:\b(?:static|async|get|set)\s+|\*\s*))+$/.exec(before);
    add(name, nameStart - (modifiers ? modifiers[0].length : 0), match.get(bodyOpen));
  }

  return found;
}

function findPythonFunctions(source) {
  const { masked, stringLines } = maskPython(source);
  const match = matchBrackets(masked);
  const lineOf = makeLineLookup(source);
  const lines = masked.split('\n');

  const depthAtLineStart = [];
  let depth = 0;
  for (const line of lines) {
    depthAtLineStart.push(depth);
    for (const c of line) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
  }

  const found = [];
  const definition = new RegExp(`^([ \\t]*)(?:async[ \\t]+)?def[ \\t]+(${IDENT})[ \\t]*\\(`, 'gm');
  for (const hit of masked.matchAll(definition)) {
    const paramsOpen = hit.index + hit[0].length - 1;
    const paramsClose = match.get(paramsOpen);
    if (paramsClose === undefined) continue;

    // The colon that opens the body; a return annotation may contain brackets.
    let colon = paramsClose + 1;
    while (colon < masked.length && masked[colon] !== ':') {
      colon = match.has(colon) && match.get(colon) > colon ? match.get(colon) + 1 : colon + 1;
    }
    if (colon >= masked.length) continue;

    const indent = hit[1].length;
    const defIndex = lineOf(hit.index) - 1;
    const colonIndex = lineOf(colon) - 1;
    const baseDepth = depthAtLineStart[defIndex];

    let endIndex = colonIndex;
    if (lines[colonIndex].slice(colon - source.lastIndexOf('\n', colon) ).trim() === '') {
      let next = colonIndex + 1;
      for (; next < lines.length; next++) {
        const text = lines[next];
        if (text.trim() === '' || depthAtLineStart[next] > baseDepth) continue;
        if (lines[next - 1].trimEnd().endsWith('\\')) continue;
        if (text.length - text.trimStart().length <= indent) break;
      }
      // Step back over blank and comment-only lines, keeping multi-line strings.
      endIndex = next - 1;
      while (endIndex > colonIndex && lines[endIndex].trim() === '' && !stringLines.has(endIndex + 1)) {
        endIndex--;
      }
    }

    // Decorators belong to the function, including ones spread over several lines.
    let startIndex = defIndex;
    for (;;) {
      let previous = startIndex - 1;
      while (previous >= 0 && depthAtLineStart[previous] > baseDepth) previous--;
      if (previous < 0 || !lines[previous].trimStart().startsWith('@')) break;
      startIndex = previous;
    }

    found.push({ name: hit[2], startLine: startIndex + 1, endLine: endIndex + 1 });
  }
  return found;
}

// Returns the functions in `source` that are 4 to 120 lines long, nested ones
// included, in the order they start.
function extractFunctions(source, language) {
  const text = source.replace(/\r\n/g, '\n');
  const finder = language === 'python' ? findPythonFunctions : findJavaScriptFunctions;
  const lines = text.split('\n');
  return finder(text)
    .map(({ name, startLine, endLine }) => ({
      name,
      startLine,
      endLine,
      code: lines.slice(startLine - 1, endLine).join('\n'),
    }))
    .filter(({ startLine, endLine }) => {
      const length = endLine - startLine + 1;
      return length >= MIN_LINES && length <= MAX_LINES;
    })
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}

function extractAll(root = process.cwd()) {
  const results = [];
  for (const file of listSourceFiles(root)) {
    let source;
    try {
      source = fs.readFileSync(path.join(root, file), 'utf8');
    } catch (error) {
      // Tracked but deleted from the working tree, or a submodule directory.
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue;
      throw error;
    }
    const language = LANGUAGE_BY_EXTENSION[path.extname(file)];
    for (const fn of extractFunctions(source, language)) {
      results.push({ file, ...fn });
    }
  }
  return results;
}

module.exports = { listSourceFiles, extractFunctions, extractAll };
