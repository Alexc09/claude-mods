# Helper Desk mascots

The Helper Desk side pane draws pixel mascots on its cards:

- The **Main chat** card shows the fries-in-the-bag worker (the default) or any mascot you pick with `/mascot`.
  A choice saved with `/mascot` wins over the default; `/mascot manager` brings back the shift manager.
- Each **subagent** card shows a fast-food crew member while crew mode is on (the default).
  With `/crew off` they show the Claude crabs instead.

Each `.svg` file in this folder is a standalone copy of one mascot (the working animation).
Open it in a browser to see it move.

## The fast-food crew

| id | Name | What moves while Claude works |
| --- | --- | --- |
| `fries-in-the-bag` | Fries in the bag (Main chat default, not crew) | A freckled teen in the crew uniform (purple-dyed hair, a smirk) tips a red fries carton over an open paper bag; three fries drop in and the bag gives a little hop, then the carton tips back (1.4 s). Both arms are red sleeves that run down into the shirt, and move with the hands |
| `manager` | Shift manager (not crew; `/mascot manager`) | Scribbles with a pencil: quick zigzag strokes along each clipboard line, the writing shows up behind the tip, the page clears after the fourth line (3 s); the head dips to the page |
| `crew-burger-flipper` | Crew burger flipper | A quick toss (0.9 s): the patty drops onto the spatula, the spatula flicks, the patty flips once in the air |
| `crew-fry-cook` | Crew fry cook | The fry basket dips and shakes; steam rises off the fries |
| `cleaner` | Cleaner | The mop swishes left and right |
| `dessert-maker` | Dessert maker | The soft-serve swirl sways, two sparkles twinkle |
| `cashier` | Cashier | A receipt prints up out of the till, the drawer pops, the display glows |
| `drive-thru` | Drive-thru | The paper bag lifts up and out, then settles |
| `drinks-station` | Drinks station | Fizz bubbles rise off the lid by the straw |
| `prep-cook` | Prep cook | The knife chops down and back |
| `dishwasher` | Dishwasher | Soap bubbles rise and pop, the plate wiggles, the sponge scrubs |
| `delivery-rider` | Delivery rider | Rides: bobs, the bag bounces, speed lines streak past |
| `trainee` | Trainee | A sweat drop slides down, the tray wobbles |

Crew moves glide (eased CSS keyframes, not steps) and loop in about 0.4 to 1.8 s.

When a turn is done, a crew member stands still (the crew fry cook keeps one faint wisp of steam).
The fries-in-the-bag worker then holds the bag up a pixel, folded shut, with a small sparkle (order
up); when a turn fails, the carton lies on its side and fries are spilled round the bag.
The shift manager then shows the page written out, the pencil put down and a small green tick;
when a turn fails, the last line is scratched out in red.
When a turn fails, it stands still and its prop goes dull where that makes sense: a burnt patty,
grey fries, a grey mop head, faded pink ice cream, a dark till display, a flat grey drink, a dull
knife, grey bubbles.

## The other mascots

| id | Name | What moves while Claude works |
| --- | --- | --- |
| `punk-cap` | Punk in a cap | Pipe smoke, ember glow, nod |
| `punk-mohawk` | Punk with a mohawk | Pipe smoke, ember glow, nod |
| `burger-flipper` | Burger flipper | Steam by the patty, sizzle, nod |
| `fry-cook` | Fry cook | Steam off the fries, fry tips flicker, quick bob |
| `classic-chef` | Classic chef | Steam off the spoon, nod |
| `line-cook` | Line cook | Wok flames flicker, smoke, quick bob |
| `pizza-maker` | Pizza maker | Quick bob |
| `grill-master` | Grill master | Smoke off the sausage, sizzle, nod |
| `barista` | Barista | Steam off the mug, heart pulses, nod |
| `sushi-chef` | Sushi chef | Knife glint, nod |
| `baker` | Baker | Flour puffs, quick bob |
| `ramen-cook` | Ramen cook | Steam off the noodles, nod |

When a turn is done, these show one slow faint wisp. When a turn fails, the puffs stop and the
flame, ember or fries go grey.

## Commands

- `/mascot` lists all 25 mascots and marks the one on the Main chat card.
- `/mascot barista` puts the barista on the Main chat card. The choice is saved, so new chats and
  restarts keep it. `/mascot fries-in-the-bag` goes back to the default; `/mascot manager` brings
  back the shift manager.
- `/crew` says whether crew mode is on.
- `/crew off` puts the Claude crabs back on subagent cards; `/crew on` brings the crew back.
  The choice is saved, and the pane redraws at once.
- `/desk` says which view the pane shows: **Cards** (the card list, the default) or **Ice floe**
  (penguins on an ice floe: Main chat in the middle, each running subagent at the next free spot,
  with speech bubbles; past 7 subagents it shows "+N more").
- `/desk floe` switches to the Ice floe; `/desk cards` switches back. The **Cards** and **Ice floe**
  buttons at the top right of the pane do the same. The choice is saved, so new chats and restarts
  keep it. The Ice floe draws in the desktop app only; the terminal keeps the cards.
- **Project checklist**: read from the project's `TODO.md` and `RESUME.md`, each found on its own (the session
  folder, else the nearest one above it, up to the git root or the home folder). When anything below has an item, the
  pane header shows two tabs, **Agents · N** (N subagents running; the default) and **Checklist**. The Agents tab keeps
  the Main chat card (or the Ice floe) first, with one line under it, "Checklist 6/9 · Now: <first in progress, else
  first to do>" (6 confirmed of 9 items; "2 to check" when only claimed items are left, else "All done"); press it to
  open the Checklist tab. The tab is kept for the chat only. Both files are read only and re-read every 3 s; with
  nothing to show there are no tabs and the pane is as in 1.8.2.
  - `TODO.md`: top-level `- [ ]` / `- [~]` / `- [x]` items under `## To do`, `## In progress`, `## Claimed done` and
    `## Confirmed done` (indented sub-items, such as earlier attempts under a bug, are skipped; a leading date is
    dropped). The section decides the group, except that an `[x]` still under To do or In progress counts as Claimed
    done, and a `[~]` under To do as In progress. Any other `#` or `##` heading ends a section; `###` does not. The tab
    shows "N of M confirmed · K to check". Claimed done items are marked `✓` under **Done, waiting for your check**;
    Confirmed done items `☑` (dimmed) under **Confirmed done**. A tick toasts "Ticked: …"; an item moving from
    Claimed done to Confirmed done toasts "Confirmed: …".
  - No `TODO.md`: the checkbox items under `RESUME.md`'s `## What the user asked for`, as before: "N of M done",
    In progress `- [~]`, To do `- [ ]` and Completed `- [x]`.
  - From `RESUME.md` always: every top-level bullet of `## Waiting on the user` (**Waiting on you**) and of
    `## In progress` (**Working on now**), from every section with that heading, in file order; `(none)` is skipped.
    These never toast and are not counted.
  - Order: Waiting on you, Working on now, In progress, To do, Done, waiting for your check, Confirmed done. Each group
    shows 8 items and "+N more" (then "Show fewer"); Confirmed done (or Completed) folds past 3 as
    "Confirmed done (N)".

## How subagent cards get their crew member

When Claude starts a subagent, its new card gets the next crew member in the list above (the 11
crew, never the manager or the fries-in-the-bag worker) that no card in the pane is wearing. The Main chat card counts too, so if
you picked a crew member with `/mascot`, no subagent card wears the same one.

- The hand-out goes round in order from a saved cursor (`crewNext` in the mod's store), so the next
  chat carries on where the last one stopped.
- The crew member is stored on the card's record, so it never changes for that card: not on redraws,
  not after other cards end, not after a reload.
- If all 11 are on screen at once, the new card reuses the one whose latest card was handed out
  longest ago.
- Each card keeps its own colour for its border and progress bar.
- On the terminal, a crew card shows a red-cap glyph (`▄██▄▄` over `(•‿•)╯`) instead of the crab.
- A finished card (✓ or ✗) stays 10 s; over its last 1.3 s the crew member and the progress bar burst into
  flying pixels (`hooks/dissolve.ts`) and the text and border fade to grey, then the card leaves. The Main chat card never bursts.

## Edit or add a mascot

All mascots are data in `hooks/mascots.ts` (the `MASCOTS` list). Each entry has:

- `id`, `name`, `alt`: what `/mascot` takes, what it shows, and the drawing's alt text.
- `map`: 24 rows of 24 letters, one letter per pixel, `.` for empty. A 1-pixel outline is added
  round the figure by itself.
- `ink`: the colour of each letter. `phaseInk` changes some letters when a turn is done or fails.
- `puffs`: where the steam or smoke starts (`at: [column, row]`) and its two colours. Leave it out for none.
- `flicker`: pixels drawn over the figure that flicker while Claude works (`px`), and an
  optional `glow` group.
- `move`: the whole figure: `nod` (1 pixel dip every 3 s), `bob` (1 pixel bob every second), `ride`
  (a smooth 1 pixel bob twice a second) or `none`.
- `rest`: pixels drawn over the still figure once a turn is `done` or `failed` (the manager's
  finished page and pencil). Keep them inside the figure: they get no outline.
- `moves`: parts that move on their own while Claude works. Each part has:
  - `box: [x0, y0, x1, y1]` (and optionally `letters`): the map pixels it takes out of the figure,
  - `add`: extra pixels only this part draws (a tick, a bubble),
  - `keys`: CSS keyframes as `[percent, declarations]`, for example `[50, 'transform:translateY(-1px)']`.
    `translate`, `rotate`, `scaleY(-1)`, `skewX`, `skewY` and `opacity` all work. A key may add its own
    `animation-timing-function` (a fall that speeds up),
  - `ease`: the timing between keys, `ease-in-out` by default; `linear` for a steady path,
    `steps(1,end)` to hold each key so pixels jump whole (the manager's writing showing up),
  - `dur` and `delay` in seconds, and `origin` for a skew or flip pivot (in the part's own box),
  - `under: true` to draw it behind the figure (the receipt slides out of the till),
  - `bare: true` for no outline (speed lines, fizz).
  A moving hand keeps its arm: put the hand and its whole sleeve in one part, and give the part a few
  `add` pixels that carry the sleeve on into the shirt (same colour), so lifting it never shows a seam
  (see `fries-in-the-bag`).
  At rest the parts line up exactly with the map, so the still drawing never changes.
- `crew: true`: hands it out to subagent cards.
- `term`: the text lines the terminal shows instead of the picture (`low` adds a third line: the manager's tie).

### Add a crew member

1. Copy a crew entry in `hooks/mascots.ts`, give it a new `id`, `name` and `alt`, and keep `crew: true`.
2. Draw its `map`. Keep the face in columns 4 to 14 and the prop on the right, clear of the face.
   Build its `ink` from `COOK_BASE`, `CREW_UNIFORM`, one `SKIN_*` tone and its own prop colours.
3. Give it `moves` that show its job, and `term: crewTerm('<prop colour>')`.
4. In the plugin folder, run `node --experimental-strip-types mascots/build.mjs` to refresh the SVG
   copies here.
5. Bump the version in `.claude-plugin/plugin.json` and in the repository's `.claude-plugin/marketplace.json`.
