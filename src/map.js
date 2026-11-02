'use strict';

const { BAR_WIDTH, paint, scoreColor, formatBar } = require('./format.js');

// One row per file: every eligible file, plus scored files that have since gone.
function summarizeFiles(files, scores) {
  const byFile = new Map(files.map((file) => [file, []]));
  for (const entry of scores) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
  }
  return [...byFile.entries()]
    .map(([file, entries]) => ({
      file,
      entries,
      average: entries.length
        ? Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length)
        : null,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function overallStats(rows) {
  const quizzed = rows.filter((row) => row.entries.length);
  const all = quizzed.flatMap((row) => row.entries);
  return {
    fileCount: rows.length,
    quizzedCount: quizzed.length,
    scoreCount: all.length,
    average: all.length ? Math.round(all.reduce((sum, entry) => sum + entry.score, 0) / all.length) : null,
  };
}

function formatMap(rows) {
  if (rows.length === 0) return 'No eligible files or saved scores yet.';
  const width = Math.max(...rows.map((row) => row.file.length));
  const lines = rows.map(({ file, entries, average }) => {
    const name = file.padEnd(width);
    if (average === null) return `${name}  ${'░'.repeat(BAR_WIDTH)}  not quizzed`;
    const all = entries.map(({ score }) => paint(scoreColor(score), String(score))).join(' ');
    return `${name}  ${formatBar(average)} ${String(average).padStart(3)}  scores: ${all}`;
  });
  const stats = overallStats(rows);
  const average = stats.average === null ? '' : `, average ${stats.average}`;
  lines.push('', `${stats.quizzedCount} of ${stats.fileCount} files quizzed, ${stats.scoreCount} ${stats.scoreCount === 1 ? 'score' : 'scores'}${average}`);
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function band(score) {
  return score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor';
}

function htmlRow({ file, entries, average }) {
  if (average === null) {
    return `<li class="row">
  <div class="line"><code>${escapeHtml(file)}</code><div class="bar"></div><span class="average none">–</span></div>
  <p class="muted">Not quizzed yet</p>
</li>`;
  }
  const rows = entries.map((entry) => `<tr>
    <td class="num ${band(entry.score)}">${Number(entry.score)}</td>
    <td><code>${escapeHtml(entry.function)}</code></td>
    <td class="num">${Number(entry.startLine)}</td>
    <td>${escapeHtml(String(entry.date).slice(0, 10))}</td>
  </tr>`).join('\n');
  return `<li class="row">
  <div class="line">
    <code>${escapeHtml(file)}</code>
    <div class="bar"><span class="${band(average)}" style="width:${average}%"></span></div>
    <span class="average ${band(average)}">${average}</span>
  </div>
  <details>
    <summary>${entries.length} ${entries.length === 1 ? 'score' : 'scores'}: ${entries.map((entry) => `<b class="${band(entry.score)}">${Number(entry.score)}</b>`).join(' ')}</summary>
    <table>
      <thead><tr><th class="num">Score</th><th>Function</th><th class="num">Line</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>
</li>`;
}

function renderHtml(rows, repoName) {
  const stats = overallStats(rows);
  const stat = (value, label) => `<div><strong>${value}</strong><span>${label}</span></div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OWNIT map: ${escapeHtml(repoName)}</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f5; --card: #fff; --text: #1d1d1b; --muted: #6b6b66; --line: #e4e4df; --track: #ecece7; --good: #1a7f4b; --fair: #a86a00; --poor: #c5352c; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --card: #1f1f1d; --text: #ededea; --muted: #a0a09a; --line: #30302d; --track: #30302d; --good: #4cc38a; --fair: #e5a93d; --poor: #f2746b; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 48px 20px; }
h1 { margin: 0; font-size: 28px; }
.sub { margin: 4px 0 28px; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 32px; margin-bottom: 28px; }
.stats strong { display: block; font-size: 28px; font-variant-numeric: tabular-nums; }
.stats span { color: var(--muted); font-size: 14px; }
ul { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.row { padding: 14px 18px; border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.line { display: grid; grid-template-columns: minmax(0, 1fr) minmax(90px, 220px) 36px; gap: 14px; align-items: center; }
code { font: 14px ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
.bar { height: 10px; background: var(--track); border-radius: 5px; overflow: hidden; }
.bar span { display: block; height: 100%; background: currentColor; }
.average { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.good { color: var(--good); } .fair { color: var(--fair); } .poor { color: var(--poor); } .none, .muted { color: var(--muted); }
.muted { margin: 6px 0 0; font-size: 14px; }
details { margin-top: 6px; font-size: 14px; }
summary { color: var(--muted); cursor: pointer; }
summary b { margin-left: 3px; }
table { width: 100%; margin-top: 8px; border-collapse: collapse; }
th, td { padding: 5px 8px; border-top: 1px solid var(--line); text-align: left; font-weight: 400; }
th { color: var(--muted); border-top: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
td.num:first-child { font-weight: 700; }
</style>
</head>
<body>
<main>
  <h1>OWNIT map</h1>
  <p class="sub">${escapeHtml(repoName)}</p>
  <div class="stats">
    ${stat(stats.average === null ? '–' : stats.average, 'average score')}
    ${stat(`${stats.quizzedCount}/${stats.fileCount}`, 'files quizzed')}
    ${stat(stats.scoreCount, 'scores')}
  </div>
  ${rows.length ? `<ul>\n${rows.map(htmlRow).join('\n')}\n</ul>` : '<p class="muted">No eligible files or saved scores yet.</p>'}
</main>
</body>
</html>
`;
}

module.exports = { summarizeFiles, formatMap, renderHtml };
