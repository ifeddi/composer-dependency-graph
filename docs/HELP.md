# Help – Composer Dependency Graph

## 1. Opening the graph

- **Tool window:** *Composer Graph* on the right-hand stripe.
- **Menu:** *Tools → Show Composer Dependency Graph*.
- **Context menu:** right-click `composer.json` or `composer.lock` (project view or editor).
  If the caret is on a `"vendor/package"` string in `composer.json`, that package is selected.

If the repository contains several `composer.json` files (up to three folders deep, ignoring `vendor`,
`node_modules`, …) a project selector appears in the toolbar.

## 2. Where the data comes from

| Source | Used when | Notes |
|---|---|---|
| `composer.lock` | present | Resolved versions of every package. Best result. |
| `vendor/composer/installed.json` | no lock file | A notice is displayed. |
| `composer.json` only | neither of the above | Only direct requirements, with their constraints as "version". |

Run `composer install` (or `composer update`) to create or refresh the lock file. The graph reloads automatically
when `composer.lock` / `composer.json` change; the ↻ button in the toolbar and the tool window title forces it.

## 3. Reading the graph

Columns go left → right: the **root package** (your `composer.json`) on the left, its requirements next, then
what those require, and so on. Every box shows the package name and the **installed version**.

| Colour | Meaning |
|---|---|
| Purple | Root package |
| Blue | Direct dependency (in `require` of the root) |
| Teal | Transitive dependency (needed by something in `require`) |
| Orange | Dev dependency (only reachable through `require-dev`) |
| Grey | Platform requirement (`php`, `ext-*`, …) or a package replaced by the root |
| Red, dashed border | Required by something but not present in the lock file |

Edges point from the requiring package to the required one. The text on an edge is the **version constraint**
written in the requiring package's `composer.json` (`Show constraints`). Dotted orange edges come from the root's
`require-dev`. Red dashed edges are `conflict` rules: `A conflicts with B <1.2` means A restricts the usable
versions of B.

A package that is `replace`d or `provide`d by an installed package (for example `psr/log-implementation`) is
connected to the package that provides it; the tooltip on the edge says "via …".

## 4. Navigating

### Search
Press `/` or `Ctrl+F`, type part of a package name (several words are combined, descriptions are searched too).
`↑` `↓` choose, `Enter` jumps to the package. Results tagged *hidden* are inside a collapsed branch or filtered
out; selecting them expands the graph to reveal them. While you type, matching nodes get a yellow outline.

### Selecting
Click a package to select it. Everything unrelated fades out, the packages it requires and the ones requiring it
stay highlighted, and the **details panel** opens:

- **Open composer.json** – opens `vendor/<package>/composer.json` (needs `composer install`). Also double-click or `Enter`.
- **Packagist** – opens the package page in your browser.
- **Why is it here?** – shortest chain from the root to this package; click any part to jump there.
- **Required by / Requires** – with constraints, click an entry to navigate. Platform requirements are listed separately.
- **Conflicts with / Restricted by conflict of** – `conflict` rules in either direction. These are drawn on the graph
  while the package is selected, even when *Show all conflicts* is off.

### Focus mode
**Dependents** shows only the packages that (transitively) require the selected one – the answer to "what breaks if
I change this?". **Dependencies** shows everything it pulls in. **Both** combines them. The bar at the top of the
graph switches modes or returns with **Show all** (`Esc`).

### Keyboard
| Key | Action |
|---|---|
| `/`, `Ctrl+F` | Search |
| `→` / `←` | Move to a dependency / to the package that requires this one (on the shortest path) |
| `↑` / `↓` | Previous / next package in the same column |
| `Enter` | Open `composer.json` of the selected package |
| `Space` | Expand / collapse the selected package |
| `+` `-` `0` | Zoom in / out / fit to screen |
| `Alt+←` | Back to the previous selection |
| `Esc` | Close search, leave focus mode, clear selection |

Mouse: drag to pan, wheel to zoom (cursor stays fixed), `Shift`+wheel pans sideways, double-click on empty space fits
the graph.

## 5. Large projects

Hundreds of packages do not fit on one screen, so the graph starts collapsed:

- Up to ~60 packages: everything is expanded.
- Up to ~220: two levels. More: only the root and its direct requirements.

A pill on the right of a node shows `+N` (N hidden dependencies) or `−` (expanded); click it to toggle.
Use the sidebar to change **Levels** (1…n or all), **Expand all** or **Collapse**. The **Most required** list at
the bottom of the sidebar shows the packages that the most others depend on – good starting points.

## 6. Filters and layout (sidebar)

| Option | Effect |
|---|---|
| Show transitive | Hide/show everything that is not a direct dependency |
| Show dev dependencies | Hide/show dev-only packages |
| Show constraints | Version constraints as labels on edges (off automatically for dense graphs) |
| Show all conflicts | Draw every `conflict` rule, not only those of the selected package |
| Show platform | Include `php`, `ext-*`, `lib-*` and packages replaced by the root |
| Layout: flow | Columns follow the longest dependency chain, so edges (almost) never point backwards |
| Layout: distance from root | Columns = shortest distance from the root; direct dependencies are always in column 2 |

Filter choices are remembered per project.

## 7. Troubleshooting

**"The embedded browser (JCEF) is not available"** – the IDE runs on a runtime without JCEF. In
*Help → Find Action → Choose Boot Java Runtime for the IDE* pick a JetBrains Runtime *with JCEF*.

**"No composer.json or composer.lock found"** – the project's base directory has none. Open the right folder, or
right-click a `composer.json` in a sub-folder and use *Show Composer Dependency Graph*.

**"Cannot open …/vendor/…"** – the package is not installed in `vendor/`; run `composer install`.

**Nodes marked "not installed"** – a package is required but is missing from the lock file (and not replaced/provided).
That usually means the lock file is stale or was generated with different platform settings.

**The graph looks outdated** – click ↻. The plugin only reloads on changes inside the project; edits made by tools
outside the IDE appear after the IDE refreshes its files (*File → Reload All from Disk*).

**Ctrl+F opens the IDE search instead** – use `/` to focus the graph's search field.

## 8. Reporting problems

Open an issue with the plugin version, your IDE version (*Help → About*), and – if possible – the output of
`composer show --tree <package>` for the package that looks wrong. Please do not attach a private `composer.lock`
unless you are fine with its content (package names and versions) being public.
