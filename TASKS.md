# Proxy Forge — open tasks

This is the work queue for AI agents (Copilot, Gemini, Nemo) and for the maintainer. Pick up **only the
task assigned to you**, read the rules below first, and update the task's **Status** line in your PR.

The page is one file, `proxy-forge.html` (about 6,000 lines). Card units are 750 × 1050 at 300 per inch,
the bleed is 37.5 units, and the safety line (`SAFE`) is ⅛″ (37.5 units) inside the cut.

---

## Where each agent works

Each agent has its own folder (a git worktree) on this machine, so one agent switching branches never
changes another's files. **Work only in your own folder**, and never run `git switch` / `git checkout` to
another agent's branch.

| Agent | Folder | Branch |
|---|---|---|
| Maintainer | `C:\Users\iansc\proxyforge` | `main` |
| Copilot | `C:\Users\iansc\proxyforge-copilot` | `ci/pages-after-verify` |
| Gemini | `C:\Users\iansc\proxyforge-gemini` | `shield-for-loyalty-defense-pt` |
| Nemo | `C:\Users\iansc\proxyforge-nemo` | `nemo/flaky-tests` |

For a new task, start a new branch from the latest `main` in your own folder:
`git fetch && git switch -c <agent>/<task> origin/main`. Run `npm ci` once in a new folder.

---

## Rules for every agent

1. **Work on a branch and open a pull request.** Never push to `main`, never merge your own PR, never
   force-push. The maintainer reviews and merges.
2. **Run the checks before opening the PR**, and paste the summary lines into the PR description:
   ```bash
   npm run verify       # build check + 17 browser tests
   npm run real-cards   # 48 real Scryfall cards through the 5 built-in layouts
   npm run safe-area    # nothing that matters may cross the safety line
   ```
   If any of them fail, fix it or say so plainly in the PR. Do not open a PR that you know is red without
   saying why.
3. **Never commit or publish these files.** They are private and git-ignored on purpose:
   `godzilla-series.md`, `playtest guides.txt`, `RECOMMENDATIONS.md`, `references/`, `art/`,
   `proxy-forge.local.html`, and any `*.png` / `*.pdf`. Do not `git add -f` them, and do not copy their
   contents into other files, comments or test fixtures.
4. **Commit attribution must be true.** Do not add a `Co-Authored-By` line that names a tool you are not
   (for example "Claude Code"). Name yourself, or add none.
5. **Stay inside your task's files.** If a fix needs a change elsewhere, explain it in the PR. Do not
   reformat, rename or "tidy" unrelated code — the file is large and other agents are editing it too.
6. **Keep these promises the tool already makes** (the tests check most of them):
   - Card text never goes below its readable floor (`TEXT_FLOOR`; rules text 24 units).
   - The name, mana cost, type line, rules and P/T/loyalty stay inside the safety line on every style.
   - The artist credit is always visible and never mirrored into the bleed.
   - Saving a PNG and the print-shop export keep working (the bleed is ⅛″ on every side).
7. **Verify visually**, not only with tests: render the cards you changed (`node tools/shot.mjs`,
   `node tools/shot-layouts.mjs`, or the browser) and attach screenshots to the PR.
8. Do not delete or rewrite tests to make them pass. A test may be changed only when it was wrong, and the
   PR must say why.

---

## Order of work

Task 1 goes first: until it lands, a broken commit on `main` still goes live. Tasks 3 and 8 both edit the
custom-layout drawing code in `proxy-forge.html`, so they go to the same agent, one after the other.

| # | Task | Owner | Depends on | Size | Status |
|---|---|---|---|---|---|
| 1 | Only publish the site when the checks pass | Copilot | — | S | Done (PR #1) |
| 2 | Agent instructions file | Copilot | — | S | Done (PR #1) |
| 3 | Loyalty and defense shields in custom styles | Gemini | — | M | Done (PR #2) |
| 4 | Flaky IndexedDB cache test | Claude (from Nemo) | — | S | Done (PR #9) |
| 5 | Flaky safety-guide test | Claude (from Nemo) | — | S | Done (PR #9) |
| 6 | GitHub Actions on Node 24 | Copilot | 1 | XS | Done (PR #1) |
| 7 | Battles printed sideways | Claude | 3, 8 | L | In review |
| 8 | "Playtest card — not for sale" on every style | Gemini | 3 | M | Done (PR #3) |
| 9 | Fantasy album shows no P/T, loyalty or defense | Gemini | 3 | XS | Done (PR #7) |
| H1 | Purge the old leaked commit from GitHub | Maintainer | — | — | Open |
| H2 | Protect the `main` branch | Maintainer | 1 | — | Open |

---

## 1. Only publish the site when the checks pass — Copilot

**Problem.** GitHub Pages is set to "deploy from branch" (legacy), so every push to `main` goes live even
when the `verify` workflow fails. On 2026-11-17 a commit with a JavaScript syntax error went live and the
whole page was broken for about three hours.

**Do.** Replace the legacy Pages build with a GitHub Actions deploy (`actions/upload-pages-artifact` +
`actions/deploy-pages`) that runs only after the `verify` job succeeds on `main`. Pull requests run
`verify` but never deploy.

**Files.** `.github/workflows/verify.yml` (or a new `deploy.yml`). Switching the Pages source to
"GitHub Actions" in the repo settings is the maintainer's step; say so in the PR.

**Done when.** A PR with a deliberately failing test shows a red check and does not deploy; a green merge
to `main` deploys; the live page at https://weclock-droid.github.io/proxy-forge/ still loads.

**Status:** Done (PR #1). The Pages source is set to "GitHub Actions".

---

## 2. Agent instructions file — Copilot

**Do.** Add `AGENTS.md` and `.github/copilot-instructions.md`. Both should state the rules above, briefly,
and point to this file.

**Done when.** Both files exist, are short (under 60 lines), and match the rules in this file.

**Status:** Done (PR #1)

---

## 3. Loyalty and defense shields in custom styles — Gemini

**Problem.** The five built-in layouts draw a planeswalker's loyalty and a battle's defense inside a shield
(`shieldPath`, `drawShield`, `drawNumberShield`, `numberKind`). The custom styles don't: 42 presets use a
`{ src: 'pt' }` layer, which prints the loyalty as a bare number (seen on Pop art and Board game with
Jace, the Mind Sculptor). Only three presets use `ptline` / `loyalty`.

**Do.** Handle it once, in `drawLayer`, for `pt` layers: when `numberKind(o)` is `'loyalty'` or
`'defense'`, draw the number inside the shield, using the layer's own text colour and background colour
(or sensible contrast if it has none), sized to the layer. Do **not** edit the 42 presets one by one.
Creatures must render exactly as they do now.

**Files.** `proxy-forge.html` (`drawLayer` and nearby helpers only).

**Done when.**
- Screenshots of Pop art, Board game, Token, Neon, Comic cover and Desktop dialog show a shield for Jace,
  the Mind Sculptor and for a battle from `tests/fixtures/cards.json`, and an unchanged P/T for a creature.
- `npm run verify`, `npm run real-cards` and `npm run safe-area` pass.
- The shield stays inside the safety line on every style.

**Status:** Done (PR #2). Fantasy album had no P/T layer at all (see task 9).

---

## 4. Flaky IndexedDB cache test — Claude (reassigned from Nemo)

**Problem.** In `tests/proxy-forge.test.mjs`, "a second lookup of the same card is served from IndexedDB"
fails now and then (once locally, once on GitHub for commit e474820). It relies on
`page.waitForTimeout(400)`.

**Do.** Find what is timing-dependent and make the test wait for a real condition (for example, that the
`api` store in IndexedDB holds the entry before reloading). Change `proxy-forge.html` only if the bug is
really in the page, and explain why in the PR.

**Done when.** `npm test` passes ten times in a row:
```bash
for i in $(seq 10); do npm test || break; done
```

**Status:** Done (PR #9). Nemo's PR #6 was closed after two rework rounds. Causes: the fake random card is the same card the test looks up, so waiting for its name didn't wait for the lookup; the reload didn't wait for the IndexedDB write; and a real page bug, where the first-visit remix could overwrite a lookup made while it was still loading.

---

## 5. Flaky safety-guide test — Claude (reassigned from Nemo)

**Problem.** "draws a line an eighth of an inch inside the cut, and only when asked" failed once under
load, then passed when run alone and in later full runs.

**Do.** Same approach as task 4: replace fixed waits with a condition the test can poll.

**Done when.** Same ten-in-a-row run as task 4.

**Status:** Done (PR #9). Two causes: the first visit's random look sometimes puts a bright green band along the top edge, which the guide's green wash makes look like the line (about 1 load in 30); and a fixed 250 ms wait after switching the guide off. The test now pins a full-art layout and polls.

---

## 6. GitHub Actions on Node 24 — Copilot

**Problem.** The workflow logs warn that `actions/checkout@v4` and `actions/setup-node@v4` run on Node 20,
which GitHub has deprecated.

**Do.** Move to versions that run on Node 24. Keep `node-version: 22` for the project itself unless a test
needs otherwise.

**Done when.** The `verify` run shows no Node 20 deprecation warning and still passes.

**Status:** Done (PR #1)

---

## 7. Battles printed sideways — Claude

**Problem.** Real battle cards are printed in landscape. The tool draws them upright like any other card.

**Do.** Tasks 3 and 8 are merged, so this can start: propose a design in the PR description first
(which layouts get a landscape version, and how the print sheet handles a sideways card) before writing it.

**Status:** In review: built to the design below (defaults accepted), with two corrections from checking a real battle (noted under c and h). Gemini, Codex and Copilot were each blocked by their account limits (Google free tier, the OpenRouter budget, the Copilot monthly quota), so Claude wrote the design.

### Design

**Core idea: rotate at draw time, keep every file portrait.** A battle is drawn in a landscape frame
(1050 × 750 card units) that is rotated 90° onto the usual 750 × 1050 canvas. Nothing downstream changes:
Save PNG, the print-shop zip, the PDF sheet, the bleed and the cut lines all keep handling one portrait
card size. That is also what print shops want (every file the same orientation) and how a sleeved battle
sits among other cards. The checks already measure text through the canvas transform
(`tools/check-real-cards.mjs` maps each `fillText` box with `getTransform()`), so rotated text is
measured where it really lands.

**a. Detection.** `numberKind(o) === 'defense'` (type line contains "Battle") on the face being drawn.
Battles are `transform` cards; `cardText(card, i)` already reads one face at a time. The front
(Battle — Siege) is drawn sideways; the back face (a creature or enchantment) is not a battle and stays
upright. All three battle fixtures in `tests/fixtures/cards.json` have this shape.

**b. Which layouts.** One new landscape layout, used when the card is a battle, the layout is `fade` or
`panel` (full art), and the new form option is on. Everything else stays upright, as now, with the
defense shield from task 3:
- `framed`, `console`, `wrist` and the 62 custom styles place everything in absolute portrait
  coordinates (`artRect`, the presets' `x`/`y`/`w`/`h`), so each would need its own landscape design.
  That's follow-up work, one style at a time, starting with `framed` if wanted.
- Swapping `W`/`H` instead of rotating is rejected: they're used ~200 times and `renderFullArt` is
  mostly literal numbers, so a swap would silently misplace things.

**c. Landscape geometry** (in the rotated frame, 1050 wide × 750 tall; `BLEED` and `SAFE` are the same
37.5 on every side, so the bleed and the safety line need no change):
- Art: the whole frame, cropped to 1050 × 750 (the bleed is mirrored as now).
- Name band: top left, from x 75; mana cost: top right, ending at x 975. Both inside y 37.5–112.
- Text panel: the bottom 300 units (y 412–712), shaded like `panel`. Type line at its top, rules below.
  Rules run about 940 wide, about 60 characters a line at size 31; the longest fixture (344 characters)
  fits in 6 lines. Longer text shrinks with the existing fitter, never below `TEXT_FLOOR.rules` (24).
- Defense shield: `drawNumberShield` at the panel's bottom-right corner, right edge ≤ 1012.5,
  bottom ≤ 712.5.
- Footer (credit, collector line, playtest note): through the existing `footerPass`, **upright** along the
  card's bottom edge, as on a printed battle (Scryfall's scan of Invasion of Ikoria). That edge is the
  frame's left end, so the name band and the text box start at x 110 instead of 48. The credit stays
  visible and is never mirrored into the bleed.
- Rotation direction: the top of the landscape frame goes to the card's **left** edge
  (`g.translate(0, H); g.rotate(-Math.PI / 2)`), confirmed against Scryfall's scan of a real battle.

**d. Save PNG and print-shop export.** Unchanged: portrait files at the usual sizes, content rotated.
`cardPng` renders through `render()`, so it gets the rotation for free; `bleedSeam`/`addBleed` work on
the portrait image as now.

**e. Print sheet and PDF.** Unchanged. A battle is a portrait card with rotated content, so it fits the
3 × 3 grid and the shared cut lines like any other card. Thumbnails come from `cardCanvas` and show it
as it will print.

**f. Preview and form.** A new checkbox, "Print battles sideways", shown only when the type line is a
battle, on by default; it's a form field (`FIELDS`), so drafts, saved sheet cards and styles keep it.
The preview shows the card as it prints (portrait, content rotated). Art panning needs the drag deltas
rotated to match, or the art moves at right angles to the mouse. A "view sideways" turn of the preview
is left out of the first version, because it would break click and drag hit-testing.

**g. Testing.**
- `npm run real-cards` already renders the three battle fixtures through `fade` and `panel`; with the
  option on by default those renders are landscape, and its safety and size checks apply unchanged.
- `npm run safe-area`: add one battle to its probe cards.
- New browser test: a battle in `fade` draws its name with a rotated transform (`getTransform().b` ≠ 0),
  the back face and a creature don't, and with the option off a battle draws upright.
- Screenshots of the three fixtures front and back, in `fade` and `panel`.

**h. Changes, in order** (one commit each):
1. `isLandscape(o)` (battle + full-art layout + option on) and the checkbox, hidden unless it applies.
   No drawing change yet.
2. `renderBattle(g, o, shade, size, bleed)`: the rotated frame and the art only; `render()` calls it
   instead of `renderFullArt` when `isLandscape(o)`.
3. Name, cost, type line, rules and the defense shield, using the existing text and fitting helpers.
4. The footer and the playtest note: no new code; `footerPass` already draws them in the card's own
   frame, upright.
5. Rotate art-pan drag deltas when landscape.
6. Tests and the safe-area probe card; screenshots in the PR.

**Risks.** Art panning (step 5) is the most likely to go wrong. Mirrored bleed on rotated art needs
checking by eye. A custom style that names `fade` as its base must not be caught by `isLandscape`.
Fonts can't be checked by the tests (they're stubbed), so the screenshots are the check for fit.

---

## 8. "Playtest card — not for sale" on every style — Gemini

**Problem.** The community rules ask for "NOT FOR SALE", "PLAYTEST" or similar on every proxy, so a print
can't pass as a real card. The form has a **Note** field (default "Playtest card — not for sale"), but
**48 of the 62 styles never print it**: popart, vhs, macro, demotiv, fried, splatter, pixglow, glowline,
retroposter, xray, desktop, rpgitem, boardgame, album, sports, altered, linocut, handdrawn, collector,
monster, monsterbw, kanji, glass, tarot, manuscript, woodblock, blueprint, synth, sketch, atlas, polaroid,
token, bronze, fantasypb, scales, pixel, storybook, pack, playtest, misprint, paperback, pulp, minimal,
comic, poster, strips, manga, zine. Only the built-in layouts and a few styles print it.

**Do.** In the custom-layout renderer, when a style has no `note` layer and the Note field is not empty,
draw the note automatically in the footer strip, opposite the artist credit (right-aligned when the
credit is left-aligned; on its own line under a centred credit). Reuse what already exists:
- `FOOT_SRC`, `footerPass` and `reflowLayers` place and protect the footer (the credit is drawn after all
  effects, so wear and misprints can't hide it; the note must get the same treatment).
- `footNote` already shrinks a note to fit next to other text (down to 15px) or moves it up a line.
- `statsBehind` picks a contrasting ink and adds a backing over busy art; the note needs the same.

The note may sit outside the safety line (like the collector line), but must stay inside the card and
must not overlap the credit, the P/T or the rules box. If the user clears the Note field, nothing is drawn.
The note's text can be changed by the **Label** setting (`swapLabel`); keep that working.

**Files.** `proxy-forge.html` (`renderCustom`, `reflowLayers`, footer helpers).

**Done when.**
- All 62 styles print the note (check with a script that hooks `fillText`, as in the safety-margin tests),
  and none print it twice.
- With the Note field empty, none of them print it.
- Screenshots of the bottom of every style show the note readable and clear of the credit and P/T.
- `npm run verify`, `npm run real-cards` and `npm run safe-area` pass. Consider adding a test for the
  first two points.

**Status:** Done (PR #3)

---

## 9. Fantasy album shows no P/T, loyalty or defense — Gemini

**Problem.** The `album` preset has no `pt` layer, so a creature's power/toughness, a planeswalker's
loyalty and a battle's defense are never printed on that style.

**Do.** Add one `pt` layer to the `album` preset where it fits the design (clear of the rules box, the
name band and the credit, inside the safety line). Task 3's shield then applies to it automatically.

**Done when.** Album prints a creature's P/T and Jace's loyalty shield, and the three checks pass.

**Status:** Done (PR #7)

---

## H1. Purge the old leaked commit — Maintainer

Commit `7ef3ed1` (which briefly published private files) was removed from `main` by a force-push, but
GitHub still serves it to anyone with its exact address. Ask GitHub Support to remove cached views and
unreferenced commits for `weclock-droid/proxy-forge`.

**Status:** Open

## H2. Protect the `main` branch — Maintainer

After task 1 lands: repo **Settings → Branches → Add rule** for `main`, require a pull request and the
`verify` status check, and block force-pushes. This is what actually stops an agent from pushing to
`main`; the rules above only ask nicely.

**Status:** Open
