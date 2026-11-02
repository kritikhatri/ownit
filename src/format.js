'use strict';

const BAR_WIDTH = 20;
const COLOR_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function paint(color, text) {
  return COLOR_ENABLED ? `${color}${text}${RESET}` : text;
}

function scoreColor(score) {
  return score >= 80 ? GREEN : score >= 50 ? YELLOW : RED;
}

function formatBar(score) {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  return paint(scoreColor(score), '█'.repeat(filled)) + '░'.repeat(BAR_WIDTH - filled);
}

module.exports = { BAR_WIDTH, GREEN, YELLOW, RED, paint, scoreColor, formatBar };
