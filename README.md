# WP Performance + Structure Inspector (Chrome Extension)

A Chrome extension for quickly auditing WordPress pages from the browser popup.

It detects WordPress/theme/plugin signals, shows performance and DOM structure metrics, provides duplicate-ID debugging tools, and gives fast access to common `wp-admin` routes.

## Features

### Overview tab
- WordPress detection badge
- Theme name detection
- Page builder detection (Elementor, Divi, Gutenberg, etc.)
- WordPress version detection (when exposed)
- WooCommerce presence
- **Plugin Insights (Likely)** with:
  - plugin name
  - confidence score
  - evidence line (fingerprint/source)

### Admin tab
- **Quick Admin Links** in 3-column card grid (Dashboard, Posts, Pages, Users, Settings, Appearance, Plugins, Tools)
- Quick actions:
  - Open Customizer
  - Manage Plugins
  - Media Library
  - Check Updates
  - Speed tools shortcut
- Cache helpers:
  - Attempt purge cache actions from known plugin toolbar links
  - Open page source

### Performance tab
- Asset counts (JS, CSS, images, fonts, iframes)
- Render-blocking script list
- Lazy-loading check (`img` without `loading="lazy"`)
- Basic recommendations based on thresholds

### Structure tab
- Elementor detection + stats (sections, columns, widgets, version)
- DOM metrics:
  - total nodes
  - max depth
  - duplicate ID count
- **Duplicate ID details**:
  - list of duplicate ID names + counts
  - `Scroll to` button to jump/highlight the element in-page

### Background behavior
- Adds `WP` badge on tabs that look like WordPress pages.

## How plugin detection works

Plugin detection is heuristic-based and uses multiple signals:
- `/wp-content/plugins/<slug>/...` asset paths
- asset URL alias/fingerprint matching
- runtime `performance` resource entries
- plugin-specific DOM/global signatures (for selected popular plugins)

Results are scored and labeled as likely confidence, not guaranteed truth.

## Install (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder:
   - `wp-performance-extension-chrome`
6. Pin the extension and open any site to start scanning.

## Usage

1. Open a page in Chrome.
2. Click the extension icon.
3. Navigate tabs:
   - `Overview`
   - `Admin`
   - `Performance`
   - `Structure`
4. Press refresh (`↺`) in popup footer to re-scan the current page.

## Project structure

- `manifest.json` — extension manifest (MV3)
- `popup/popup.html` — popup layout
- `popup/popup.css` — popup styles
- `popup/popup.js` — popup controller + in-page inspector logic
- `background/service-worker.js` — background tab badge logic
- `content/inspector.js` — passive content script and message handlers
- `icons/` — extension icons

## Permissions

From `manifest.json`:
- `activeTab` — run inspector against current active tab
- `scripting` — inject inspector/utility functions into page context
- `storage` — reserved for persisted settings/data
- `tabs` — tab metadata + open admin/source links
- `host_permissions: <all_urls>` — allow scanning across visited pages

## Known limitations

- Plugin detection can be obscured by CDN rewrites, minification, or security controls.
- Some sites hide WordPress version/theme/plugin traces intentionally.
- Cross-origin iframe internals are not inspected.
- Duplicate ID `Scroll to` targets the first matching element for that ID.

## Version

- Extension version: `1.0.0`

## License

No license file is currently included in this repository.
