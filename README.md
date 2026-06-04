# Award Interpreter — Local Setup

Run the single-file React component (`App.jsx`, which uses `lucide-react` for icons) on your
machine in under 5 minutes. Two ways: do it yourself with five commands, or let an agent do it.

## Prerequisites

You need Node.js 18 or newer. Check it:

```
node -v
```

If you see `v18.x` (or higher), you're set — npm comes bundled with Node. If the command is not
found, install Node from https://nodejs.org and open a new terminal.

## Setup — five commands

Run these in order, from any folder where you want the project to live:

```
npm create vite@latest award-interpreter -- --template react
cd award-interpreter
npm install
npm install lucide-react
npm run dev
```

The same commands work in Windows PowerShell, macOS Terminal, and Linux shells. They do not
prompt you for anything — the project name and `react` (JavaScript) template are already supplied.

## Add the component

1. Open `src/App.jsx` in the new `award-interpreter` folder.
2. Delete everything in it, paste in the full contents of the provided `App.jsx`, and save.
3. Open `src/index.css`, delete everything in it, and save. (The starter's default styles center
   and pad the page; clearing them lets the component use its own full-page layout. `App.jsx`
   ships all the styling it needs and does not import a CSS file.)

Vite hot-reloads on save — no need to restart.

## What to expect

- After `npm run dev`, the terminal prints a line like `Local: http://localhost:5173/`. Open that
  URL in your browser.
- At first you'll see **Vite's default React demo** — the spinning logos and a click counter. That
  confirms the project runs.
- After you paste `App.jsx` and clear `index.css` and save, the page reloads to the **Award
  Interpreter** — an "Upload" screen with two file cards (Timesheet and Award Document) and an
  "Interpret award" button. That's the component running.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npm`/`node` "command not found" | Node not installed, or terminal opened before install | Install Node 18+ from nodejs.org, then open a new terminal and retry. |
| Blank white page | `App.jsx` not fully replaced, or a partial paste | Make sure you replaced the whole file (it ends with `export default function App`). Check the browser console and the terminal for the error. |
| `Failed to resolve import "lucide-react"` / missing module | Dependency not installed, or wrong folder | Run `npm install lucide-react` from inside the `award-interpreter` folder, then `npm run dev`. |
| Looks plain / unstyled, or content is centered and padded | Fonts blocked (offline) and/or `index.css` not cleared | The component loads Google Fonts at runtime — connect to the internet for the intended look (it falls back to system fonts offline). Make sure `src/index.css` is empty. |
| `Port 5173 is in use` | Another dev server is already running | Vite will offer the next port (e.g. 5174) — use that, or run `npm run dev -- --port 3000`. |
| Dev server crashes when you save | Syntax error from an incomplete paste | Re-copy the entire `App.jsx` and save again. If it stays down, stop it and run `npm run dev`. |

## Stop and restart

- **Stop:** press `Ctrl + C` in the terminal running the server (same on Windows, macOS, and Linux).
- **Restart:** run `npm run dev` again.
- **Come back later:** `cd award-interpreter` then `npm run dev`.

## Alternative — let Google Antigravity do it

Instead of the steps above, paste this prompt into Google Antigravity's Agent Manager (with the
`App.jsx` file already in the workspace). Review the agent's plan, approve it, and it will set
everything up and open the app in its built-in browser:

```
Set up and run this React component locally.

1. Initialise a new Vite + React project using the JavaScript template in the current workspace.
2. Install all dependencies, including lucide-react.
3. Replace the generated src/App.jsx with the existing App.jsx already in this workspace
   (keep that App.jsx's contents exactly; it is the component to run).
4. Empty src/index.css so the project's default styles do not override the component, which
   ships its own styling and imports no CSS file.
5. Start the Vite dev server.
6. Open the built-in browser at the local URL Vite prints (usually http://localhost:5173).

When done, tell me the local URL and confirm the Award Interpreter "Upload" screen is showing.
```
