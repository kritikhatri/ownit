# OWNIT

AI writes more and more of our code. It runs, it ships, and often nobody can explain it. OWNIT checks whether you actually understand your own code, and you answer out loud with Wispr Flow because you can't fake an explanation when you have to say it.

It's a command-line tool with no dependencies: it picks a random function from your repo, asks you to explain it, and has Gemini score your answer.

```
███████████████░░░░░ 75/100

✓ It calls fn again if it fails.
● The function retries `fn` up to `times` attempts.
● If `fn` fails on all `times` attempts, the error from the last attempt is re-thrown.

Follow-up: What determines how many times `fn` is called, and what happens if it fails on the final attempt?
```

## Setup

You need Git, Node.js 18 or later (tested on 22), and a [Gemini API key](https://aistudio.google.com/apikey).

```sh
git clone https://github.com/kritikhatri/ownit.git
cd ownit
npm link
export GEMINI_API_KEY="your-key"
```

Add the `export` line to your shell profile (such as `~/.zshrc`) to keep it across sessions. Don't commit your key.

## Usage

Run these commands inside any Git repository:

| Command | What it does |
|---|---|
| `ownit` | Quizzes you on a random function |
| `ownit map` | Shows each file with a bar and all its scores |
| `ownit map --html` | Creates a webpage of the map at `.git/ownit-map.html` |
| `ownit diff` | Asks you to explain your current Git changes |
| `ownit diff --min 70` | Same, but exits with code 1 if your score is below 70 |

### Answering

Type or dictate your answer; pasted answers can span several lines. Press Enter on an empty line to finish. Ctrl-D also finishes, and skips a follow-up without changing your score.

### Scoring

Gemini starts at 100 and subtracts 15–30 points for each wrong claim and 3–10 for each missing detail, so being wrong costs more than being incomplete. A follow-up answer then adds or subtracts up to 15 points. Scores can vary slightly between runs.

### After each round

`ownit` ends each round with a menu:

- **Next:** quiz another function
- **Learn:** show a simple explanation of this function
- **Map:** show the map
- **Quit:** exit

## What gets quizzed

- **Included:** functions of 4 to 120 lines in `.js`, `.jsx`, `.mjs`, `.cjs` and `.py` files tracked by Git.
- **Skipped:** `node_modules`, `dist`, test folders and test files.
- **`ownit diff`:** covers staged and unstaged changes to tracked files. Run `git add` on a new file to include it. Diffs over 100,000 characters are cut off, and diff scores aren't saved.

## Privacy

Each quiz sends the function's code, its file path and your answers to Google's Gemini API. `ownit diff` sends your diff, so check it for secrets first.

Scores are saved locally in `.git/ownit-scores.json`, without your answers. They aren't committed or pushed, so they stay on your machine.

## Configuration

| Environment variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Your API key (required for `ownit` and `ownit diff`) |
| `GEMINI_MODEL` | The model to use (default: `gemini-2.5-flash`) |
| `NO_COLOR` | Turns off colored output when set |

## Limitations

Functions are found with a built-in scanner rather than a full parser. Unusual syntax can give wrong line ranges or missed functions, and some forms such as JavaScript methods with quoted names aren't detected. TypeScript isn't supported.
