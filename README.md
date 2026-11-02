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

## Built by voice

I built OWNIT by voice. I dictated every prompt to my AI assistant with Wispr Flow, including the ones behind the commits and this README, one phase at a time:

- Finding functions
- Reading answers
- Grading with Gemini
- Follow-ups
- The map

Demo video: coming soon.

## What didn't work

- **Dictated answers could get cut off.** Wispr Flow pastes a whole answer at once, so stopping at the first blank line would end it too early. I learned that voice input arrives in bursts, not keystrokes. Now you finish by pressing Enter on an empty line, with a short wait in case more pasted text is coming.
- **Gemini sometimes failed with overloaded errors or timeouts, and the user lost the answer they had just spoken.** I learned that losing someone's effort is worse than making them wait, so now it tries up to four times before giving up.
- **A crash while saving could break the scores file and wipe someone's history.** So I save to a temporary file first, then swap it in.
- **Finding functions without a real parser was harder than expected.** Brackets and keywords inside strings, comments and regexes look like real code. Now the scanner blanks those out before it looks for functions.

## Why I Built This

A time I had code that worked but I couldn't fully explain it was when I was new to web coding, and I just coded without really thinking about anything.

Building OWNIT, the thing that surprised me most was how easily Wispr helped me work on this project.

At Wispr, I would love to be part of the team and make more projects with Wispr.
