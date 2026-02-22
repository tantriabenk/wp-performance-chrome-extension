/* ============================================================
   WP Inspector — Popup Controller
   ============================================================ */

let currentTabId = null;
let currentTabUrl = null;
let siteData = null;

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId  = tab.id;
  currentTabUrl = tab.url || '';

  // Safe hostname display — guard against chrome:// / about: tabs
  try {
    document.getElementById('page-url').textContent = new URL(currentTabUrl).hostname;
  } catch (_) {
    document.getElementById('page-url').textContent = currentTabUrl || '—';
  }

  setupTabs();
  setupButtons();
  await scan();
});

// ── Tab Switching ─────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Scan / Refresh ────────────────────────────────────────
async function scan() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: runInspector,
    });
    siteData = result?.result ?? null;
    if (siteData) {
      renderAll(siteData);
    } else {
      showError('No data returned from page.');
    }
  } catch (e) {
    console.error('Inspector error:', e);
    showError(e.message);
  } finally {
    btn.classList.remove('spinning');
  }
}

// ── Render All ────────────────────────────────────────────
function renderAll(data) {
  renderOverview(data);
  renderPerformance(data);
  renderStructure(data);
  renderAdmin(data);
}

// ── Overview Tab ──────────────────────────────────────────
function renderOverview(data) {
  const badge = document.getElementById('wp-badge');
  badge.innerHTML = data.isWordPress
    ? '<span class="badge badge--wp">WordPress</span>'
    : '<span class="badge badge--not-wp">Not WP</span>';

  setText('theme-name',   data.theme        || 'Unknown');
  setText('page-builder', data.pageBuilder  || 'None detected');
  setText('wp-version',   data.wpVersion    || 'Unknown');
  setText('woo-status',   data.hasWooCommerce ? '✓ Active' : '✗ Not found');

  // Plugins
  const pluginList = document.getElementById('plugin-list');
  pluginList.innerHTML = (data.plugins && data.plugins.length > 0)
    ? data.plugins.map(p => `<div class="plugin-tag"><span class="dot"></span>${escHtml(p)}</div>`).join('')
    : '<div class="empty-state">No plugins detected from markup.</div>';

  // Performance score
  const score = computeScore(data);
  document.getElementById('score-fill').style.width      = `${score}%`;
  document.getElementById('score-fill').style.background =
    score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  document.getElementById('score-label').textContent = `${score}/100`;
  document.getElementById('score-hint').textContent  =
    score >= 80 ? 'Good — Page looks lean and fast.'
    : score >= 50 ? 'Average — Some optimizations recommended.'
    : 'Poor — Multiple performance issues found.';
}

// ── Performance Tab ───────────────────────────────────────
function renderPerformance(data) {
  const a = data.assets || {};
  setStatRow('js-count',     'js-badge',     a.scripts, [10, 20]);
  setStatRow('css-count',    'css-badge',    a.styles,  [8,  15]);
  setStatRow('img-count',    'img-badge',    a.images,  [20, 40]);
  setStatRow('font-count',   'font-badge',   a.fonts,   [3,   6]);
  setStatRow('iframe-count', 'iframe-badge', a.iframes, [1,   3]);

  // Lazy load
  const noLazy = data.imagesWithoutLazy ?? 0;
  const noLazyEl = document.getElementById('no-lazy-count');
  noLazyEl.textContent  = noLazy;
  noLazyEl.style.color  = noLazy === 0 ? 'var(--green)' : noLazy <= 3 ? 'var(--yellow)' : 'var(--red)';

  // Render blockers
  const blockersList = document.getElementById('blockers-list');
  blockersList.innerHTML = (data.renderBlockers && data.renderBlockers.length > 0)
    ? data.renderBlockers.map(b => `<div class="blocker-item">🚫 ${escHtml(b)}</div>`).join('')
    : '<div class="empty-state">✓ No render-blocking resources detected.</div>';

  // Recommendations
  const recs  = buildRecommendations(data);
  const recEl = document.getElementById('recommendations');
  recEl.innerHTML = recs.length > 0
    ? recs.map(r =>
        `<div class="rec-item">
           <span class="rec-icon">${r.icon}</span>
           <div class="rec-text"><strong>${escHtml(r.title)}</strong> — ${escHtml(r.body)}</div>
         </div>`).join('')
    : '<div class="empty-state">✓ No major recommendations. Looking good!</div>';
}

// ── Structure Tab ─────────────────────────────────────────
function renderStructure(data) {
  const nodes = data.domNodes     || 0;
  const depth = data.domDepth     || 0;
  const dups  = data.duplicateIds || 0;

  setText('dom-nodes', nodes);
  setStatBadge('dom-badge',   nodes, [800,  1500]);
  setText('dom-depth', depth);
  setStatBadge('depth-badge', depth, [15,   25]);
  setText('dup-ids',   dups);

  const dupBadge = document.getElementById('dup-badge');
  if      (dups === 0) applyBadge(dupBadge, 'good', 'OK');
  else if (dups <   5) applyBadge(dupBadge, 'warn', `${dups} found`);
  else                 applyBadge(dupBadge, 'bad',  `${dups} found`);

  // Elementor status card
  const elStatus = document.getElementById('elementor-status');
  const el = data.elementor;

  if (el && el.detected) {
    elStatus.classList.add('detected');
    elStatus.innerHTML = `
      <strong style="color:var(--accent)">✓ Elementor Detected</strong>
      <div class="el-meta">
        <span class="el-stat">Sections: <strong>${el.sections}</strong></span>
        <span class="el-stat">Columns: <strong>${el.columns}</strong></span>
        <span class="el-stat">Widgets: <strong>${el.widgets}</strong></span>
        <span class="el-stat">Version: <strong>${el.version || 'unknown'}</strong></span>
      </div>`;
  } else {
    elStatus.classList.remove('detected');
    elStatus.innerHTML = '<span class="empty-state">Elementor not detected on this page.</span>';
  }

}

// ── Admin Tab ─────────────────────────────────────────────
function renderAdmin(data) {
  const adminLinks = document.getElementById('admin-links');

  if (!data.isWordPress || !data.adminUrl) {
    adminLinks.innerHTML = '<div class="empty-state">Visit a WordPress site to see admin links.</div>';
    return;
  }

  const base = data.adminUrl;
  const links = [
    { icon: '🏠', label: 'Dashboard',  url: base },
    { icon: '📝', label: 'Posts',      url: `${base}edit.php` },
    { icon: '📄', label: 'Pages',      url: `${base}edit.php?post_type=page` },
    { icon: '👤', label: 'Users',      url: `${base}users.php` },
    { icon: '⚙️', label: 'Settings',   url: `${base}options-general.php` },
    { icon: '🎨', label: 'Appearance', url: `${base}themes.php` },
    { icon: '🔌', label: 'Plugins',    url: `${base}plugins.php` },
    { icon: '🛠️', label: 'Tools',      url: `${base}tools.php` },
  ];

  adminLinks.innerHTML = links.map(l =>
    `<a class="admin-link" href="${escHtml(l.url)}" target="_blank">
       <span class="al-icon">${l.icon}</span>
       <span class="al-label">${escHtml(l.label)}</span>
       <span class="al-arrow">→</span>
     </a>`
  ).join('');
}

// ── Setup Buttons ─────────────────────────────────────────
function setupButtons() {
  document.getElementById('refresh-btn').addEventListener('click', scan);

  // Admin quick actions
  const adminBtn = (btnId, pathFn) => {
    document.getElementById(btnId).addEventListener('click', () => {
      if (!siteData?.adminUrl) { showToast('Not a WordPress site'); return; }
      chrome.tabs.create({ url: pathFn(siteData.adminUrl) });
    });
  };

  adminBtn('open-elementor',  b => `${b}post.php?action=elementor`);
  adminBtn('open-customizer', b => `${b}customize.php`);
  adminBtn('open-plugins',    b => `${b}plugins.php`);
  adminBtn('open-media',      b => `${b}upload.php`);
  adminBtn('open-updates',    b => `${b}update-core.php`);
  adminBtn('open-perf',       b => `${b}options-general.php`);

  document.getElementById('purge-cache').addEventListener('click', async () => {
    await injectScript(tryPurgeCache, []);
    showToast('Cache purge attempted');
  });

  document.getElementById('view-source').addEventListener('click', () => {
    if (currentTabUrl) chrome.tabs.create({ url: `view-source:${currentTabUrl}` });
  });
}

// ── Utility: inject a standalone function into the active tab ──
async function injectScript(func, args) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func, args });
  } catch (e) {
    console.warn('Inject failed:', e);
  }
}

// ── Score ─────────────────────────────────────────────────
function computeScore(data) {
  let score = 100;
  const { scripts = 0, styles = 0 } = data.assets || {};

  if      (scripts > 20) score -= 20;
  else if (scripts > 10) score -= 10;

  if      (styles > 15) score -= 15;
  else if (styles > 8)  score -= 8;

  score -= (data.renderBlockers?.length || 0) * 5;

  if      (data.imagesWithoutLazy > 5) score -= 10;
  else if (data.imagesWithoutLazy > 0) score -= 5;

  if      (data.domNodes > 1500) score -= 10;
  else if (data.domNodes > 800)  score -= 5;

  if (data.domDepth > 25) score -= 10;

  if (data.elementor?.detected && data.elementor.sections > 20) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// ── Recommendations ───────────────────────────────────────
function buildRecommendations(data) {
  const recs = [];
  const a = data.assets || {};

  if (a.scripts > 15)
    recs.push({ icon: '📜', title: 'Too many scripts',
      body: `${a.scripts} JS files detected. Combine or defer where possible.` });

  if (data.renderBlockers?.length > 0)
    recs.push({ icon: '🚫', title: 'Render-blocking resources',
      body: `${data.renderBlockers.length} resource(s) blocking page render.` });

  if (data.imagesWithoutLazy > 3)
    recs.push({ icon: '🖼️', title: 'Missing lazy loading',
      body: `${data.imagesWithoutLazy} images don't have loading="lazy".` });

  if (data.domNodes > 1500)
    recs.push({ icon: '🌳', title: 'Large DOM',
      body: `${data.domNodes} DOM nodes. Consider simplifying structure.` });

  if (a.fonts > 4)
    recs.push({ icon: '🔤', title: 'Font overload',
      body: `${a.fonts} web font requests. Limit to 2–3 font families.` });

  if (data.duplicateIds > 0)
    recs.push({ icon: '⚠️', title: 'Duplicate IDs',
      body: `${data.duplicateIds} duplicate element IDs found. This breaks CSS/JS selectors.` });

  return recs;
}

// ── DOM Helpers ───────────────────────────────────────────
function setStatRow(valId, badgeId, val, thresholds) {
  const el = document.getElementById(valId);
  if (!el) return;
  el.textContent = val ?? '—';
  if (val !== undefined) {
    const [warn, bad] = thresholds;
    el.style.color = val <= warn ? 'var(--green)' : val <= bad ? 'var(--yellow)' : 'var(--red)';
  }
  setStatBadge(badgeId, val, thresholds);
}

function setStatBadge(id, val, [warn, bad]) {
  const el = document.getElementById(id);
  if (!el || val === undefined) return;
  if      (val <= warn) applyBadge(el, 'good', 'Good');
  else if (val <= bad)  applyBadge(el, 'warn', 'High');
  else                  applyBadge(el, 'bad',  'Too many');
}

function applyBadge(el, cls, text) {
  el.className    = `stat-badge ${cls}`;
  el.textContent  = text;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(msg) {
  document.getElementById('wp-badge').innerHTML = '<span class="badge badge--not-wp">Error</span>';
  console.warn('WP Inspector error:', msg);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed', 'bottom:40px', 'left:50%', 'transform:translateX(-50%)',
    'background:#22263a', 'border:1px solid #4f8ef7', 'color:#e2e8f0',
    'padding:6px 14px', 'border-radius:6px', 'font-size:12px',
    'z-index:9999', 'white-space:nowrap',
  ].join(';');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ============================================================
// PAGE-INJECTED FUNCTIONS — run inside the inspected tab
// These must be self-contained (no closure references to popup scope)
// ============================================================

function runInspector() {
  const result = {
    isWordPress:      false,
    theme:            null,
    wpVersion:        null,
    pageBuilder:      null,
    hasWooCommerce:   false,
    adminUrl:         null,
    plugins:          [],
    assets:           { scripts: 0, styles: 0, images: 0, fonts: 0, iframes: 0 },
    renderBlockers:   [],
    imagesWithoutLazy: 0,
    domNodes:         0,
    domDepth:         0,
    duplicateIds:     0,
    elementor:        { detected: false },
  };

  const bodyClasses = document.body?.className || '';

  // ── WordPress detection ──
  const wpMeta = document.querySelector('meta[name="generator"]');
  const wpJson = document.querySelector('link[rel="https://api.w.org/"]');
  result.isWordPress = !!(
    bodyClasses.includes('wp-') ||
    wpJson ||
    (wpMeta && wpMeta.content?.includes('WordPress')) ||
    document.querySelector('link[href*="/wp-content/"]') ||
    document.querySelector('script[src*="/wp-includes/"]')
  );

  // ── WP Version ──
  if (wpMeta?.content?.includes('WordPress')) {
    const m = wpMeta.content.match(/WordPress\s+([\d.]+)/);
    if (m) result.wpVersion = m[1];
  }

  // ── Admin URL — derive from existing wp-admin links, fall back to origin ──
  try {
    const adminLinks = Array.from(document.querySelectorAll('a[href*="/wp-admin/"]'));
    if (adminLinks.length > 0) {
      const m = adminLinks[0].href.match(/^(https?:\/\/.+?\/wp-admin)\//);
      result.adminUrl = m ? m[1] + '/' : `${location.origin}/wp-admin/`;
    } else {
      result.adminUrl = `${location.origin}/wp-admin/`;
    }
  } catch (_) {
    result.adminUrl = `${location.origin}/wp-admin/`;
  }

  // ── Theme ──
  const themeClass = bodyClasses.match(/\btheme-([a-zA-Z0-9_-]+)\b/);
  if (themeClass) {
    result.theme = themeClass[1];
  } else {
    const themeLink = document.querySelector('link[href*="/themes/"]');
    if (themeLink) {
      const m = themeLink.href.match(/\/themes\/([^/?#]+)/);
      if (m) result.theme = m[1];
    }
  }

  // ── Page builder ──
  const builders = [
    ['Elementor',      () => !!(document.querySelector('[data-elementor-type]') || document.querySelector('.elementor-section') || bodyClasses.includes('elementor'))],
    ['Beaver Builder', () => !!(document.querySelector('.fl-builder-content')   || bodyClasses.includes('fl-builder'))],
    ['Divi',           () => !!(document.querySelector('#et-boc')               || bodyClasses.includes('et_pb_page'))],
    ['Gutenberg',      () =>  !!document.querySelector('.wp-block')],
    ['Visual Composer',() =>  !!document.querySelector('.vc_row')],
    ['Oxygen',         () =>  !!document.querySelector('[class*="ct-section"]')],
    ['Bricks',         () =>  !!document.querySelector('[class*="brxe-"]')],
    ['WPBakery',       () =>  !!document.querySelector('.vc_column_container')],
  ];
  for (const [name, detect] of builders) {
    if (detect()) { result.pageBuilder = name; break; }
  }

  // ── WooCommerce ──
  result.hasWooCommerce = !!(document.querySelector('.woocommerce') || bodyClasses.includes('woocommerce'));

  // ── Plugin detection ──
  const allSrcs = [
    ...Array.from(document.querySelectorAll('script[src]')).map(s => s.src),
    ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(l => l.href),
  ];
  const pluginMap = [
    ['WP Rocket',        s => s.includes('wp-rocket')],
    ['Yoast SEO',        s => s.includes('yoast') || s.includes('wpseo')],
    ['Contact Form 7',   s => s.includes('contact-form-7') || s.includes('wpcf7')],
    ['WooCommerce',      s => s.includes('woocommerce')],
    ['WPML',             s => s.includes('wpml') || s.includes('sitepress')],
    ['Elementor',        s => s.includes('/elementor/')],
    ['RankMath',         s => s.includes('rank-math')],
    ['Slider Revolution',s => s.includes('revslider')],
    ['Smush',            s => s.includes('wp-smushit')],
    ['Jetpack',          s => s.includes('jetpack')],
    ['ACF',              s => s.includes('advanced-custom-fields') || s.includes('/acf/')],
    ['Gravity Forms',    s => s.includes('gravityforms')],
    ['Polylang',         s => s.includes('polylang')],
    ['W3 Total Cache',   s => s.includes('w3tc') || s.includes('w3-total-cache')],
    ['MonsterInsights',  s => s.includes('monsterinsights')],
    ['Beaver Builder',   s => s.includes('bb-plugin') || s.includes('beaver-builder')],
    ['Divi',             s => s.includes('/divi/')],
    ['WPForms',          s => s.includes('wpforms')],
    ['Ninja Forms',      s => s.includes('ninja-forms')],
    ['Cookie Notice',    s => s.includes('cookie-notice')],
  ];
  const detected = new Set();
  for (const [name, test] of pluginMap) {
    if (allSrcs.some(test)) detected.add(name);
  }
  result.plugins = Array.from(detected);

  // ── Asset counts ──
  result.assets.scripts = document.querySelectorAll('script[src]').length;
  result.assets.styles  = document.querySelectorAll('link[rel="stylesheet"]').length;
  result.assets.images  = document.querySelectorAll('img').length;
  result.assets.iframes = document.querySelectorAll('iframe').length;
  result.assets.fonts   = Array.from(document.querySelectorAll('link[href]')).filter(l =>
    l.href.includes('fonts.googleapis.com') ||
    l.href.includes('fonts.gstatic.com')    ||
    l.href.includes('use.typekit')          ||
    l.href.includes('use.fontawesome')      ||
    /\.(woff2?|ttf|otf)/i.test(l.href)
  ).length;

  // ── Render blockers (sync scripts in <head>) ──
  result.renderBlockers = Array.from(
    document.head?.querySelectorAll('script[src]') || []
  )
    .filter(s => !s.defer && !s.async && s.getAttribute('type') !== 'module')
    .map(s => { try { return new URL(s.src).pathname.split('/').pop() || s.src; } catch { return s.src; } })
    .slice(0, 10);

  // ── Images without lazy ──
  result.imagesWithoutLazy = Array.from(document.querySelectorAll('img')).filter(img =>
    img.loading !== 'lazy'             &&
    !img.dataset.src                   &&
    !img.dataset.lazy                  &&
    !img.hasAttribute('data-lazy-src') &&
    !img.hasAttribute('data-lazyload') &&
    img.src && !img.src.startsWith('data:')
  ).length;

  // ── DOM stats ──
  result.domNodes = document.querySelectorAll('*').length;

  // Iterative max-depth (avoids stack overflow on deep DOMs)
  (function calcDepth() {
    let max = 0;
    const stack = [[document.body, 0]];
    while (stack.length) {
      const [node, d] = stack.pop();
      if (d > max) max = d;
      if (node?.children) {
        for (const child of node.children) stack.push([child, d + 1]);
      }
    }
    result.domDepth = max;
  })();

  // Duplicate IDs
  const idMap = {};
  document.querySelectorAll('[id]').forEach(el => {
    if (el.id) idMap[el.id] = (idMap[el.id] || 0) + 1;
  });
  result.duplicateIds = Object.values(idMap).filter(c => c > 1).length;

  // ── Elementor ──
  const elSections = document.querySelectorAll(
    '.elementor-section, [data-element_type="section"], [data-element_type="container"]'
  );
  const elColumns = document.querySelectorAll('.elementor-column, [data-element_type="column"]');
  const elWidgets = document.querySelectorAll('.elementor-widget');
  const elVersion = document.querySelector('[data-elementor-version]')?.dataset?.elementorVersion;

  if (elSections.length > 0 || document.querySelector('[data-elementor-type]')) {
    const tree = [];
    let si = 0;
    elSections.forEach(section => {
      const sType = section.dataset?.element_type || 'section';
      tree.push({ type: 'section', label: `${sType.charAt(0).toUpperCase() + sType.slice(1)} #${++si}`, depth: 0 });

      const cols = section.querySelectorAll(
        ':scope > .elementor-container > .elementor-row > .elementor-column,' +
        ':scope > .elementor-column,' +
        ':scope > [data-element_type="column"]'
      );
      cols.forEach((col, ci) => {
        tree.push({ type: 'column', label: `Column ${ci + 1}`, depth: 1 });
        const ws = col.querySelectorAll(
          ':scope > .elementor-column-wrap > .elementor-widget-wrap > .elementor-widget,' +
          ':scope > .elementor-widget'
        );
        ws.forEach(w => {
          const wType = w.className.match(/elementor-widget-([a-z_-]+)/)?.[1] || w.dataset?.element_type || 'widget';
          tree.push({ type: 'widget', label: wType.replace(/-/g, ' '), depth: 2 });
        });
      });
    });

    result.elementor = {
      detected: true,
      sections: elSections.length,
      columns:  elColumns.length,
      widgets:  elWidgets.length,
      version:  elVersion || null,
      tree,
    };
  }

  return result;
}

function tryPurgeCache() {
  const selectors = [
    'a[href*="purge_nonce"]',
    'a[href*="wp-cache"]',
    'a[href*="w3tc_flush"]',
    '#wp-admin-bar-wp-rocket a',
    '#wp-admin-bar-w3tc-empty-all a',
    '#wp-admin-bar-autoptimize a',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return 'clicked'; }
  }
  return 'no-cache-plugin-found';
}
