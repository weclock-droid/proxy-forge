# Instructions for AI agents

The task queue, the owner of each task and the full rules are in **[TASKS.md](TASKS.md)**. Read it first
and do only the task assigned to you.

## Rules

- **Your own folder only.** Each agent has its own git worktree (see "Where each agent works" in
  TASKS.md). Never `git switch` / `git checkout` another agent's branch, and never work in another
  agent's folder.
- **Branch and pull request.** Start each task on a new branch from the latest `origin/main`. Never push
  to `main`, never merge your own PR, never force-push.
- **Run the checks before opening a PR**, and paste their summary lines into the PR:
  `npm run verify`, `npm run real-cards`, `npm run safe-area`. If one fails, say so plainly, even when you
  think the failure isn't yours.
- **Private files never leave this machine:** `godzilla-series.md`, `playtest guides.txt`,
  `RECOMMENDATIONS.md`, `references/`, `art/`, `proxy-forge.local.html`, and any `*.png` / `*.pdf`. Don't
  force-add them, copy their contents anywhere, or put them in deployment artifacts.
- **Truthful attribution.** Never add a `Co-Authored-By` line naming a tool you are not.
- **Stay inside your task's files.** Explain any change elsewhere in the PR; don't reformat or tidy
  unrelated code.
- **Check it visually.** Render the cards you changed and attach screenshots to the PR.
- **Don't rewrite tests to make them pass.** Change a test only when it was wrong, and say why in the PR.
- **Keep the tool's promises:** text never below its readable floor (`TEXT_FLOOR`), the name, cost, type,
  rules and P/T inside the safety line (⅛″ inside the cut), the artist credit always visible, and PNG and
  print-shop exports working.
