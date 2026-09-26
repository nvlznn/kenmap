# KenMap

Measures how much of your codebase you still understand.

Coverage tools tell you which lines your tests touch. KenMap tells you which
modules you can still explain. It quizzes you on one module at a time, records
the score, and drops that score as the code underneath it changes — so a module
rewritten by an AI you didn't follow goes red on its own.

The result is a heatmap of your repo plus a README badge.

## How the score works

```
module score = mean of its 3 most recent answers, each × (1 − churn)
churn        = min(1, max(added, deleted) / max(lines_then, lines_now))
```

Answers are graded 0 / 0.25 / 0.5 / 0.75 / 1. Churn is measured from the commit
you were quizzed at to HEAD. Scores never decay with time alone — only code
changes move them.

## Design

KenMap assumes nothing about your repo. Source layout, package manifests,
language and module boundaries are all discovered from `git ls-files` at
runtime. It works on any language; import edges are drawn when a language
adapter recognizes the code, and omitted when none does.

An LLM only writes questions and grades answers. Scanning, scoring and every
file write are deterministic scripts.

- `.kenmap.json` on your main branch holds the module boundaries you confirmed.
- An orphan `kenmap-data` branch holds results, report and badge.
- No backend, no database.

## Install

KenMap runs as a Claude Code skill. Link it rather than copying, so the page
template stays reachable:

```bash
ln -s "$PWD/skill" ~/.claude/skills/kenmap
```

Then, in any repo:

```
/comprehend init     # discover structure, agree on module boundaries
/comprehend          # answer one question about the weakest module
```

## Status

Working end to end: discovery, scoring, the skill, the local map, publishing
and the badge. Not yet exercised: a real GitHub remote, and the question
quality bar over a long run of quizzes.

```
npm test
```
