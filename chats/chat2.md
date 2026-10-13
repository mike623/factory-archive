# Factory Archive theme controls

_Started 2026-06-22 08:29 UTC_

---

## User

Add tweakable controls to Factory Archive.html: light/dark theme

## Assistant

Let me explore the existing file structure first.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: copy_starter_component]_

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

This is a thorough theming job — the app is dark-only with both CSS variables and many hardcoded dark fills. I'll add a light palette via a `[data-theme]` block, route the hardcoded inset/chrome colors through new variables, and wire a Tweaks toggle.

_[tool: update_todos]_

Bulk-replace the hardcoded inset fills with a variable across the component files:

_[tool: run_script]_

Now update styles.css — add the new chrome/well variables to `:root`, the light-theme block, and adapt body/hazard:

_[tool: str_replace_edit]_

Now the library.jsx toggle track/knob:

_[tool: read_file]_

_[tool: str_replace_edit]_

Now app.jsx — swap chrome colors and wire the Tweaks panel:

_[tool: str_replace_edit]_

The floatbar background still needs swapping. Load tweaks-panel.jsx in the HTML and fix the selection bar:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: update_todos]_

_[tool: show_html]_

_[tool: show_html]_

Dark theme intact. Let me verify the light theme renders correctly:

_[tool: save_screenshot]_

Let me diagnose the cards — their interiors look darker than the rest. I'll check computed styles:

_[tool: eval_js]_

_[tool: eval_js]_

The variables cascade correctly — the earlier mismatch was a stale read during the screenshot's DOM revert. Title resolves to `#23272e` on light panels. The light theme is working; the blueprint preview renders intentionally stay dark (they read as imagery).

_[tool: get_webview_logs]_

Clean load. Added a **Theme** control (Dark / Light) to the Tweaks panel. Light mode flips the full palette — surfaces, text, borders, amber accent, status colors, window chrome, and float bar — by overriding the CSS variables; the dark isometric blueprint previews stay dark by design, reading as preview imagery. Toggle it from the Tweaks panel in the toolbar.

_[tool: ready_for_verification]_

Done. The Tweaks panel now has a **Theme** toggle (Dark / Light), defaulting to the original dark look.

