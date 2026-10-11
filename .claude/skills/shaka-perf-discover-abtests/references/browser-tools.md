# Browser capabilities across agents

Use a real browser with tab management, navigation, page JavaScript execution,
user input/scrolling, viewport resizing, and screenshots. Inspect the session's
tool descriptions before choosing an adapter. MCP prefixes and APIs vary;
these names are examples, not assumptions that a tool exists.

| Capability | Claude Code with Chrome | Codex | Playwright MCP or another agent |
| --- | --- | --- | --- |
| Find/create/close tabs | `mcp__claude-in-chrome__tabs_context_mcp`, `tabs_create_mcp`, and documented tab controls | `mcp__cua_repl.js` with the documented `cua` tab APIs, when exposed | `browser_tabs` or equivalent tab controls |
| Navigate and interact | Chrome `navigate`, `read_page`, `find`, `computer`, and form tools | Documented browser interaction APIs through `mcp__cua_repl.js` | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`, or equivalents |
| Run browser-side probes | `mcp__claude-in-chrome__javascript_tool` | The browser execution API documented by the available adapter, only when permitted | `browser_evaluate` or equivalent browser JavaScript execution |
| Scroll with user input | Chrome `scroll` / `computer` scroll action as documented | The adapter's documented wheel/scroll action | Available browser code runner with `page.mouse.wheel()`, or equivalent user scroll action |
| Resize viewport | `mcp__claude-in-chrome__resize_window` | The available adapter's documented viewport controls | `browser_resize` or equivalent |
| Capture/view screenshots | Chrome screenshot action; `Read` for saved PNGs | Adapter screenshot API; `view_image` for saved PNGs | `browser_take_screenshot` and the host's image viewer |

For Codex CUA, first obtain the relevant app/browser/tab using its required
entry point and read the returned API documentation. Do not invent methods or
assume that page JavaScript execution or viewport resizing is supported.
Some execution APIs permit read-only DOM inspection only; use their documented
interaction controls for scrolling and other changes. Report a blocker if a
required probe needs mutations that the adapter does not permit.
Playwright MCP or a documented Playwright CLI can also be used in Codex when
available and permitted. Follow integration-specific restrictions; do not switch
adapters to bypass a restriction imposed by the session.

The CLI's `extract-links`, `probe-lazy-load`, and `probe-sections` commands print
browser JavaScript source. Execute that source in the target page using the
adapter's documented input format. For Playwright `browser_evaluate`, wrap the
source in the required function and return its result. `extract-links` is an
expression; `probe-sections` runs a function that returns candidates.
`probe-lazy-load` defines JavaScript strings named `STEP1`, `AT_BOTTOM`, and
`STEP2`: execute the appropriate string in the page for each phase, retaining
the before/after results. If the adapter isolates each call, obtain the string
from the printed source again rather than assuming previous bindings persist.
Do not execute DOM probes
in a shell's Node process: it has no target page.

Preserve probe results, wait for page readiness, and use actual wheel/scroll
input where the workflow requires it. An HTTP response cannot verify rendering,
interactions, or screenshots. If essential capabilities are unavailable, report
which capability is missing and stop the dependent phase.

Use Claude `Bash`, Codex `exec_command`, or another shell tool for CLI helpers.
Use Claude `AskUserQuestion`, available Codex question tools, or ordinary
conversation for missing required input; wait for the answer. Delegation is
optional and requires both available tools and session authorization.
