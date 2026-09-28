---
name: comprehend
description: Quiz yourself on one module of this repo and record how well you still understand it. Use when the user runs /comprehend, asks to be quizzed on code they own, asks how much of their codebase they still understand, or wants to set up or update KenMap module boundaries.
---

# comprehend

Measures how much of this repo the user still understands, one module and one
question at a time. Scores live in the `kenmap-data` branch and fall as the code
underneath them changes.

Scripts live next to this file in `scripts/`. Run them with `node`. **Never
write `.kenmap.json` or `results.jsonl` by hand** — the scripts validate what
goes in, and a hand-edited score is not evidence of anything.

## Usage

- `/comprehend` — quiz the lowest-scoring module
- `/comprehend <module-or-path>` — quiz a specific module, named either by its
  id or by a file/folder path inside it (e.g. the file the user has open)
- `/comprehend init` — set up or revise module boundaries

If `.kenmap.json` does not exist, run the init flow first, whatever was asked.

## Init flow

1. Run `node scripts/structure.mjs --json`. It reports every directory at every
   depth with file counts, lines, generated-file share and import concentration,
   plus any package manifests it found.
2. Show the user what is there — directories, sizes, and which ones look
   generated. Keep it to the shape of the repo, not a file listing.
3. Propose module boundaries **for this repo's actual shape**. There is no
   target number of modules. Judgement, in order:
   - Package manifests are real boundaries. Respect them.
   - Cut at whatever depth carries meaning. Some repos mean something at depth
     1, some bury their structure five levels down.
   - If files sit flat in one directory, use import concentration from
     `structure.mjs` to find the seams.
   - Leave mostly-generated directories out, and say that you did. Never drop
     them silently — excluded code cannot lower the score.
   - Give each module a reason, not just a glob.
4. Let the user correct you. This is their map; they will be living with these
   boundaries for months.
5. Write it:
   ```bash
   node scripts/write-config.mjs --json '{"version":1,"user":"<github-handle>","modules":{"<id>":["<glob>"]}}'
   ```
   Globs are relative to the repo root. The script refuses any module that
   matches no files.
6. Ask before committing `.kenmap.json`, and before adding `.kenmap-data/` to
   `.gitignore`. Both touch the user's main branch.

**Re-running init:** never overwrite silently. Show the current modules and
ask whether to keep, adjust or replace them. Warn that renaming a module id
orphans its recorded answers.

## Quiz flow

1. **Pick the module.** Given an argument, resolve it with
   `node scripts/scan.mjs --resolve "<argument>"` — it accepts a module id or a
   file/folder path and returns `{ moduleId }`. If it returns `candidates`
   instead (the path spans more than one module), ask the user which one they
   meant. With no argument, run `node scripts/report.mjs` and take the
   lowest-scoring module, preferring one that has never been quizzed.
2. **Check the working tree.** If `git status --porcelain` is not empty, say so:
   the score binds to the current commit, so uncommitted work is not covered.
   Ask whether to continue. Do not refuse.
3. **Read the code.** Use `node scripts/scan.mjs --files` to list the module's
   files. Read up to about 1,500 lines; if the module is larger, read the files
   other modules import most, since those carry the contracts.
4. **Ask exactly one question.** One question per run — this must stay short
   enough to run on a whim.
5. **Grade it** 0, 0.25, 0.5, 0.75 or 1, explain the answer, and record it.
6. **Record, report, render:**
   ```bash
   node scripts/record.mjs --module <id> --score <0|0.25|0.5|0.75|1> \
     --question "<the question>" --answer "<what they said>" --rationale "<why this grade>"
   node scripts/render.mjs
   ```
   `render.mjs` recomputes the report and opens the map locally. Then **ask**
   whether to publish; if yes, `node scripts/publish.mjs`.

## What makes a question worth asking

The whole tool is worthless if the questions can be answered by looking. Ask
only about things that live in the user's head: **why the code is shaped this
way, and what would break if it were shaped differently.**

Aim at the module's responsibility, its boundaries, how data moves through it,
how it fails, and what was traded away.

Good:
- "If the retry logic moved from the queue consumer into the HTTP client, what
  would start going wrong?"
- "Two screens read this cache. Why does one of them bypass it?"
- "What happens to an in-flight write when the auth token expires mid-request?"
- "This module exposes three repositories but the app only ever injects one.
  What is the other two's reason to exist?"

Bad — never ask these:
- "What methods does `PaymentService` have?" (read it)
- "What does `formatDate` do?" (read it)
- "How many files are in this module?" (count them)
- "What package does this import?" (read it)
- "What does this function return?" (read it)

A useful test: if the answer is visible on screen while you are asking, it is
the wrong question.

Grade on whether the user's mental model matches the system, not on wording:

| score | meaning |
|---|---|
| 1 | Explains the mechanism and the consequence correctly |
| 0.75 | Right conclusion, fuzzy or incomplete reasoning |
| 0.5 | Half the picture — knows one side of the trade-off, misses the other |
| 0.25 | Recognizes the area but the model is wrong |
| 0 | No working model of this |

Be honest. A generous grade is a lie told to the only person it can hurt.

## Reading the score

`score = mean of the module's 3 most recent answers, each × (1 − churn)`, where
churn is how much of the module changed between the commit the user was quizzed
at and HEAD. Scores never decay with time alone. If an answer's baseline commit
was squashed away, its churn shows as unverifiable rather than as zero — say so
rather than quietly trusting the number.
