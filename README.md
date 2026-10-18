# Pixel Bowl

Your Sleeper fantasy matchup, played as an 8-bit football game.

Static site. No build step, no server, no database.

## How it works
- The browser pulls league, users, rosters and weekly matchups from the public Sleeper API.
- `src/engine.js` turns each matchup into an original game, deterministically (same league + week + matchup = same game):
  - Final score = each team's fantasy total ÷ 5, rounded. The fantasy winner always wins.
  - The NFL week's kickoff slots are laid across the 60-minute clock (Thursday opens, Monday closes). Each team's score follows its fantasy total along that clock.
  - Touches, yards and TDs go to starters by fantasy points, leaning on whoever was producing at that point of the week. Run/catch style comes from real weekly stats.
- `src/render.js` draws it on a 320×180 canvas.
- `data/` holds static files rebuilt daily by GitHub Actions (`scripts/build-data.mjs`):
  `players.json` (Sleeper ids → name/pos/team/number), `schedule.json` (kickoffs), `styles/<week>.json` (weekly stat lines), `demo.json` (demo league).

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy
Import the repo in Vercel (framework preset: Other, no build command, output = repo root). The data workflow commits refreshed files, which redeploys automatically.

## Routes
- `#/` home
- `#/demo` demo league
- `#/l/<leagueId>/w/<week>` a week's matchups
- `#/l/<leagueId>/w/<week>/m/<matchupId>` watch a game
