# Design reference

- **`Statement Analytics v2.dc.html`** — the mockup the screens were built from.
  Open it in a browser; it loads `support.js` and the design system's
  stylesheet from `_ds/`, and ECharts from a CDN. The app itself draws its
  charts with recharts and a palette computed for colour-vision separation
  ([decisions.md](../decisions.md#presentation)), so the mockup's colours are
  not the app's.
- **`_ds/nocturne-…/readme.md`** — the Nocturne design system: tokens, the
  component classes and the rules for using them. The app's copy of its
  stylesheet is `frontend/src/styles/nocturne.css`, verbatim.
