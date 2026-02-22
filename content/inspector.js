/* ============================================================
   WP Inspector — Content Script
   Runs passively on every page. Listens for messages from
   the popup / service worker.
   ============================================================ */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__wpInspectorLoaded) return;
  window.__wpInspectorLoaded = true;

  // ── Message Router ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg.action) {
      case 'ping':
        reply({ ok: true });
        break;

      case 'get_data':
        reply(collectData());
        break;

      case 'highlight':
        handleHighlight(msg.on);
        reply({ ok: true });
        break;

      case 'purge_cache':
        reply({ result: tryPurgeCache() });
        break;

      default:
        break;
    }
    return true; // keep channel open for async
  });

  // ── Data Collection ───────────────────────────────────────
  function collectData() {
    return {
      url: location.href,
      title: document.title,
      isWordPress: detectWordPress(),
      theme: detectTheme(),
      wpVersion: detectWPVersion(),
      pageBuilder: detectPageBuilder(),
      hasWooCommerce: detectWooCommerce(),
      adminUrl: guessAdminUrl(),
      plugins: detectPlugins(),
      assets: countAssets(),
      renderBlockers: findRenderBlockers(),
      imagesWithoutLazy: countImagesWithoutLazy(),
      domNodes: document.querySelectorAll('*').length,
      domDepth: getMaxDepth(document.body),
      duplicateIds: findDuplicateIds(),
      elementor: inspectElementor(),
    };
  }

  function detectWordPress() {
    const body = document.body?.className || '';
    return !!(
      body.includes('wp-') ||
      document.querySelector('link[rel="https://api.w.org/"]') ||
      document.querySelector('meta[name="generator"][content*="WordPress"]') ||
      document.querySelector('link[href*="/wp-content/"]') ||
      document.querySelector('script[src*="/wp-includes/"]')
    );
  }

  function detectTheme() {
    const body = document.body?.className || '';
    const themeClass = body.match(/\btheme-([a-zA-Z0-9_-]+)\b/);
    if (themeClass) return themeClass[1];

    const cssLink = document.querySelector('link[href*="/themes/"]');
    if (cssLink) {
      const m = cssLink.href.match(/\/themes\/([^/]+)\//);
      if (m) return m[1];
    }
    return null;
  }

  function detectWPVersion() {
    const meta = document.querySelector('meta[name="generator"][content*="WordPress"]');
    if (meta) {
      const m = meta.content.match(/WordPress\s+([\d.]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function detectPageBuilder() {
    const body = document.body?.className || '';
    const checks = [
      ['Elementor', () => !!(document.querySelector('[data-elementor-type]') || document.querySelector('.elementor') || body.includes('elementor'))],
      ['Beaver Builder', () => !!(document.querySelector('.fl-builder') || body.includes('fl-builder'))],
      ['Divi', () => !!(document.querySelector('#et-boc') || body.includes('et_pb_page'))],
      ['Gutenberg', () => !!document.querySelector('.wp-block')],
      ['Visual Composer', () => !!document.querySelector('.vc_row')],
      ['Oxygen', () => !!document.querySelector('[class*="ct-section"]')],
      ['Bricks', () => !!document.querySelector('[class*="brxe-"]')],
      ['WPBakery', () => !!document.querySelector('.vc_column_container')],
    ];
    for (const [name, detect] of checks) {
      if (detect()) return name;
    }
    return null;
  }

  function detectWooCommerce() {
    const body = document.body?.className || '';
    return !!(document.querySelector('.woocommerce') || body.includes('woocommerce'));
  }

  function guessAdminUrl() {
    // Try to find admin links already on page
    const links = Array.from(document.querySelectorAll('a[href*="wp-admin"]'));
    for (const link of links) {
      const m = link.href.match(/^(https?:\/\/[^#?]+\/wp-admin)\//);
      if (m) return m[1] + '/';
    }
    // Fallback: assume standard install
    return `${location.origin}/wp-admin/`;
  }

  function detectPlugins() {
    const allSrcs = [
      ...Array.from(document.querySelectorAll('script[src]')).map(s => s.src),
      ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(l => l.href),
    ];

    const pluginMap = {
      'WP Rocket': s => s.includes('wp-rocket'),
      'Yoast SEO': s => s.includes('yoast') || s.includes('wpseo'),
      'Contact Form 7': s => s.includes('contact-form-7') || s.includes('wpcf7'),
      'WooCommerce': s => s.includes('woocommerce'),
      'WPML': s => s.includes('wpml') || s.includes('sitepress'),
      'Elementor': s => s.includes('/elementor/'),
      'RankMath': s => s.includes('rank-math'),
      'Slider Revolution': s => s.includes('revslider'),
      'Smush': s => s.includes('wp-smushit'),
      'Jetpack': s => s.includes('jetpack'),
      'ACF': s => s.includes('advanced-custom-fields') || s.includes('/acf/'),
      'Gravity Forms': s => s.includes('gravityforms'),
      'Polylang': s => s.includes('polylang'),
      'W3 Total Cache': s => s.includes('w3tc') || s.includes('w3-total-cache'),
      'MonsterInsights': s => s.includes('monsterinsights') || s.includes('google-analytics-for-wordpress'),
      'Beaver Builder': s => s.includes('bb-plugin') || s.includes('beaver-builder'),
      'Divi': s => s.includes('/divi/'),
      'Cookie Notice': s => s.includes('cookie-notice'),
      'WP Forms': s => s.includes('wpforms'),
      'Ninja Forms': s => s.includes('ninja-forms'),
    };

    const detected = new Set();
    for (const [name, test] of Object.entries(pluginMap)) {
      if (allSrcs.some(test)) detected.add(name);
    }
    return Array.from(detected);
  }

  function countAssets() {
    const fontLinks = Array.from(document.querySelectorAll('link[href]')).filter(l =>
      l.href.includes('fonts.googleapis.com') ||
      l.href.includes('fonts.gstatic.com') ||
      l.href.includes('use.typekit') ||
      l.href.includes('use.fontawesome') ||
      /\.(woff2?|ttf|otf)/i.test(l.href)
    );

    return {
      scripts: document.querySelectorAll('script[src]').length,
      styles: document.querySelectorAll('link[rel="stylesheet"]').length,
      images: document.querySelectorAll('img').length,
      fonts: fontLinks.length,
      iframes: document.querySelectorAll('iframe').length,
    };
  }

  function findRenderBlockers() {
    return Array.from(document.head?.querySelectorAll('script[src]') || [])
      .filter(s => !s.defer && !s.async && s.getAttribute('type') !== 'module')
      .map(s => {
        try { return new URL(s.src).pathname.split('/').pop() || s.src; } catch { return s.src; }
      })
      .slice(0, 10);
  }

  function countImagesWithoutLazy() {
    return Array.from(document.querySelectorAll('img')).filter(img =>
      img.loading !== 'lazy' &&
      !img.dataset.src &&
      !img.dataset.lazy &&
      !img.hasAttribute('data-lazy-src') &&
      !img.hasAttribute('data-lazyload') &&
      img.src &&
      !img.src.startsWith('data:')
    ).length;
  }

  function getMaxDepth(root, depth = 0) {
    if (!root || !root.children || root.children.length === 0) return depth;
    let max = depth;
    for (const child of root.children) {
      const d = getMaxDepth(child, depth + 1);
      if (d > max) max = d;
    }
    return max;
  }

  function findDuplicateIds() {
    const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(Boolean);
    const counts = {};
    ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    return Object.values(counts).filter(c => c > 1).length;
  }

  function inspectElementor() {
    const sections = document.querySelectorAll('.elementor-section, [data-element_type="section"], [data-element_type="container"]');
    const columns = document.querySelectorAll('.elementor-column, [data-element_type="column"]');
    const widgets = document.querySelectorAll('.elementor-widget, [data-element_type="widget"]');
    const versionEl = document.querySelector('[data-elementor-version]');

    if (sections.length === 0 && !document.querySelector('[data-elementor-type]')) {
      return { detected: false };
    }

    const tree = [];
    let si = 0;
    sections.forEach(section => {
      si++;
      const sectionType = section.dataset?.element_type || 'section';
      tree.push({ type: 'section', label: `${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)} #${si}`, depth: 0 });

      const cols = section.querySelectorAll(':scope > * > * > [data-element_type="column"], :scope > .elementor-column, :scope > [data-element_type="column"]');
      cols.forEach((col, ci) => {
        tree.push({ type: 'column', label: `Column ${ci + 1}`, depth: 1 });
        const ws = col.querySelectorAll(':scope > * > .elementor-widget, :scope > .elementor-widget');
        ws.forEach(w => {
          const wType = w.dataset?.element_type || w.className.match(/elementor-widget-([a-z_-]+)/)?.[1] || 'widget';
          tree.push({ type: 'widget', label: wType.replace(/-/g, ' '), depth: 2 });
        });
      });
    });

    return {
      detected: true,
      sections: sections.length,
      columns: columns.length,
      widgets: widgets.length,
      version: versionEl?.dataset?.elementorVersion || null,
      tree,
    };
  }

  // ── Highlight Toggle ──────────────────────────────────────
  function handleHighlight(on) {
    const STYLE_ID = 'wp-inspector-highlight-style';
    const existing = document.getElementById(STYLE_ID);

    if (!on) {
      existing?.remove();
      document.querySelectorAll('[data-wpi]').forEach(el => {
        el.removeAttribute('data-wpi');
        el.removeAttribute('data-wpi-label');
      });
      return;
    }

    if (!existing) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        [data-wpi="section"] {
          outline: 3px solid #4f8ef7 !important;
          outline-offset: 3px !important;
          position: relative !important;
        }
        [data-wpi="section"]::before {
          content: attr(data-wpi-label) !important;
          position: absolute !important;
          top: 0 !important; left: 0 !important;
          background: #4f8ef7 !important; color: #fff !important;
          font: 700 10px/1 monospace !important;
          padding: 3px 7px !important;
          z-index: 99999 !important;
          pointer-events: none !important;
          border-radius: 0 0 4px 0 !important;
        }
        [data-wpi="column"] {
          outline: 2px dashed #7c5dfa !important;
          outline-offset: 2px !important;
        }
        [data-wpi="widget"] {
          outline: 1px solid #22c55e !important;
          outline-offset: 1px !important;
        }
      `;
      document.head.appendChild(style);
    }

    let si = 0;
    document.querySelectorAll('.elementor-section, [data-element_type="section"], [data-element_type="container"]').forEach(el => {
      el.setAttribute('data-wpi', 'section');
      el.setAttribute('data-wpi-label', `§${++si}`);
    });
    document.querySelectorAll('.elementor-column, [data-element_type="column"]').forEach(el => {
      el.setAttribute('data-wpi', 'column');
    });
    document.querySelectorAll('.elementor-widget').forEach(el => {
      el.setAttribute('data-wpi', 'widget');
    });
  }

  // ── Cache Purge ───────────────────────────────────────────
  function tryPurgeCache() {
    const purgeSelectors = [
      '#wp-admin-bar-wp-rocket a',
      '#wp-admin-bar-w3tc-empty-all a',
      '#wp-admin-bar-autoptimize a',
      'a[href*="purge_nonce"]',
    ];
    for (const sel of purgeSelectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return 'clicked'; }
    }
    return 'no-cache-plugin';
  }

})();
