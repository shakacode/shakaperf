---
name: frontend-design
metadata:
  internal: true
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

Use the host’s file/edit and shell tools: Claude `Read` / `Edit` / `Write` / `Bash`, Codex `exec_command` / `apply_patch`, or equivalents. Inspect screenshots with Claude `Read`, Codex `view_image`, or an equivalent image viewer.

## Browser selection and setup

Before live browser work, use Claude Chrome tools when available in Claude Code;
otherwise use `agent-browser` (including non-Claude agents). Read the exposed tool
descriptions and `agent-browser --help` plus relevant command help. Follow the
session's permissions and browser restrictions; report a blocker if this route
is prohibited or lacks an essential capability. HTTP responses do not verify UI.

Check `command -v agent-browser` before using the CLI. If missing, provide
`npm install -g agent-browser` or, on macOS, `brew install agent-browser`. Install
it when the session authorizes package installation. `npx skills` installs
instructions, not this executable or a browser.
ShakaPerf's global installation does not guarantee a downloaded browser either.

For standalone inspection, choose a unique `AB_SESSION` per worker and open the
requested `URL` with `agent-browser --session "$AB_SESSION" open "$URL"`.
Allow automatic detection of existing Chrome/Chromium. If detection fails, inspect
the effective ShakaPerf browser options for `executablePath` or `channel`. Resolve
its active package from the CLI symlink or development wrapper, then load that
package's `playwright` with Node `createRequire` rooted there (and its Yarn PnP
runtime for a source install); inspect `chromium.executablePath()` and check that
the file exists. Do not resolve the target project's unrelated Playwright or
hard-code a machine path. Retry with
`agent-browser --session "$AB_SESSION" --executable-path "$BROWSER_EXECUTABLE" open "$URL"`.
This reuses the binary but launches a new process; it does not attach to ShakaPerf.
If no compatible browser exists, stop and provide the platform's
[Chrome installer](https://www.google.com/chrome/) or Chromium package instructions.
For a missing ShakaPerf Playwright build, use the exact bundled Playwright
installation command printed by ShakaPerf's error.

For troubleshooting, wait until the relevant side is parked: visreg logs
`Test completed`; perf labels its page `[PERF]` after its test function settles.
A session manifest alone does not establish readiness. Run
`shaka-perf troubleshoot session` in the application's directory and use
the endpoint printed for the desired side:
`agent-browser --session "$AB_SESSION" connect "$CDP_ENDPOINT"`.
List tabs with `agent-browser --session "$AB_SESSION" tab`, match the full
control/experiment URL, then select its returned tab ID with `tab "$TAB_ID"`.
The reported URLs are starting targets. If the test navigated, use its known
navigation and the side's origin to identify the parked tab. If identity remains
ambiguous, resolve it before interacting; do not guess.
Visreg's endpoint contains both sides; perf endpoints are per side. Confirm
`get url` before interacting. Never assume port 9222, auto-attach to another
browser, or manipulate browsers during active measurements.

Keep the selected session and tab for subsequent commands. Use separate sessions
and tabs for parallel workers; an agent-browser session has one active tab.
Finish with `agent-browser --session "$AB_SESSION" close`: it closes browsers
launched by that session and only disconnects from external CDP browsers.
Do not run `tab close` on ShakaPerf-owned tabs. With Claude Chrome, retain the tab
ID, follow the tool's lifecycle rules, and close only tabs created by this skill.

Use Claude `mcp__claude-in-chrome__tabs_context_mcp` / `tabs_create_mcp` to obtain
a tab and `navigate` to open the URL; retain that ID. For inspection and actions,
use Chrome `read_page` / `find` / `computer` / `form_input`, or agent-browser
`snapshot -i` followed by `click`, `fill`, `check`, and `select`. Run page probes
with Chrome `javascript_tool` or agent-browser `eval --stdin`. Capture with
Chrome `computer` with its screenshot action or agent-browser
`screenshot "$SCREENSHOT"`, then inspect the image with Claude `Read`, Codex
`view_image`, or another image viewer.
Resize with Chrome `resize_window` or agent-browser `set viewport <width> <height>`,
and verify `window.innerWidth` / `window.innerHeight` through page JavaScript.
Use Chrome `computer` with its scroll action or agent-browser
`mouse wheel <delta>` for incremental scrolling; agent-browser `scroll` uses
JavaScript. Pass the chosen
`--session "$AB_SESSION"` on every agent-browser browser command.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Aim for extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
