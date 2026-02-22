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
  const pluginInsights = Array.isArray(data.pluginInsights) ? data.pluginInsights : [];
  if (pluginInsights.length > 0) {
    pluginList.innerHTML = pluginInsights.map(p => {
      const confidence = Number.isFinite(p.confidence) ? p.confidence : 0;
      const evidence = Array.isArray(p.evidence) && p.evidence.length > 0
        ? p.evidence[0]
        : (p.level || 'Matched plugin signatures');
      return `<div class="plugin-tag plugin-tag--insight">
        <div class="plugin-main">
          <span class="dot"></span>
          <span class="plugin-name">${escHtml(p.name || p.slug || 'Unknown plugin')}</span>
        </div>
        <span class="plugin-confidence ${pluginConfidenceClass(confidence)}">${confidence}%</span>
        <div class="plugin-evidence">${escHtml(evidence)}</div>
      </div>`;
    }).join('');
  } else {
    pluginList.innerHTML = (data.plugins && data.plugins.length > 0)
      ? data.plugins.map(p => `<div class="plugin-tag"><span class="dot"></span>${escHtml(p)}</div>`).join('')
      : '<div class="empty-state">No plugin fingerprints detected from this page.</div>';
  }

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
  const dupDetails = Array.isArray(data.duplicateIdDetails) ? data.duplicateIdDetails : [];

  setText('dom-nodes', nodes);
  setStatBadge('dom-badge',   nodes, [800,  1500]);
  setText('dom-depth', depth);
  setStatBadge('depth-badge', depth, [15,   25]);
  setText('dup-ids',   dups);

  const dupBadge = document.getElementById('dup-badge');
  if      (dups === 0) applyBadge(dupBadge, 'good', 'OK');
  else if (dups <   5) applyBadge(dupBadge, 'warn', `${dups} found`);
  else                 applyBadge(dupBadge, 'bad',  `${dups} found`);

  const dupListEl = document.getElementById('duplicate-ids-list');
  if (dups === 0 || dupDetails.length === 0) {
    dupListEl.innerHTML = '<div class="empty-state">No duplicate IDs found.</div>';
  } else {
    dupListEl.innerHTML = dupDetails.map(item => {
      const id = String(item.id || '');
      const count = Number(item.count || 0);
      return `<div class="dup-item">
        <div class="dup-id">#${escHtml(id)}</div>
        <button class="dup-scroll-btn" data-scroll-dup-id="${escHtml(id)}">Scroll to</button>
        <div class="dup-meta">${count} element${count === 1 ? '' : 's'} share this ID</div>
      </div>`;
    }).join('');
  }

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
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!siteData?.adminUrl) { showToast('Not a WordPress site'); return; }
      chrome.tabs.create({ url: pathFn(siteData.adminUrl) });
    });
  };

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

  document.getElementById('duplicate-ids-list').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-scroll-dup-id]');
    if (!btn) return;
    const targetId = btn.getAttribute('data-scroll-dup-id');
    if (!targetId) return;
    const status = await injectScript(scrollToDuplicateId, [targetId]);
    if (status === 'scrolled') showToast(`Scrolled to #${targetId}`);
    else showToast(`Could not find #${targetId}`);
  });
}

// ── Utility: inject a standalone function into the active tab ──
async function injectScript(func, args) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func, args });
    return res?.result;
  } catch (e) {
    console.warn('Inject failed:', e);
    return null;
  }
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

function pluginConfidenceClass(score) {
  if (score >= 80) return 'plugin-confidence--high';
  if (score >= 50) return 'plugin-confidence--mid';
  return 'plugin-confidence--low';
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
    pluginInsights:   [],
    assets:           { scripts: 0, styles: 0, images: 0, fonts: 0, iframes: 0 },
    renderBlockers:   [],
    imagesWithoutLazy: 0,
    domNodes:         0,
    domDepth:         0,
    duplicateIds:     0,
    duplicateIdDetails: [],
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
  const knownPluginNames = {
    'woocommerce': 'WooCommerce',
    'elementor': 'Elementor',
    'contact-form-7': 'Contact Form 7',
    'wordpress-seo': 'Yoast SEO',
    'wp-rocket': 'WP Rocket',
    'rank-math': 'Rank Math',
    'sitepress-multilingual-cms': 'WPML',
    'revslider': 'Slider Revolution',
    'wp-smushit': 'Smush',
    'jetpack': 'Jetpack',
    'advanced-custom-fields': 'Advanced Custom Fields',
    'gravityforms': 'Gravity Forms',
    'polylang': 'Polylang',
    'w3-total-cache': 'W3 Total Cache',
    'google-analytics-for-wordpress': 'MonsterInsights',
    'bb-plugin': 'Beaver Builder',
    'divi-builder': 'Divi Builder',
    'wpforms-lite': 'WPForms',
    'ninja-forms': 'Ninja Forms',
    'cookie-notice': 'Cookie Notice',
    'wordfence': 'Wordfence',
    'litespeed-cache': 'LiteSpeed Cache',
    'all-in-one-seo-pack': 'All in One SEO',
    'autoptimize': 'Autoptimize',
    'really-simple-ssl': 'Really Simple SSL',
    'updraftplus': 'UpdraftPlus',
    'elementskit-lite': 'ElementsKit',
    'duplicate-page': 'Duplicate Page',
  };
  const aliasRules = [
    ['wpforms', 'wpforms-lite'],
    ['acf', 'advanced-custom-fields'],
    ['wpseo', 'wordpress-seo'],
    ['yoast', 'wordpress-seo'],
    ['wpcf7', 'contact-form-7'],
    ['monsterinsights', 'google-analytics-for-wordpress'],
    ['sitepress', 'sitepress-multilingual-cms'],
    ['w3tc', 'w3-total-cache'],
    ['beaver-builder', 'bb-plugin'],
    ['divi', 'divi-builder'],
    ['litespeed', 'litespeed-cache'],
  ];
  const pluginEvidence = {};
  const slugFromPathRe = /\/wp-content\/plugins\/([^/?#]+)/i;

  const normalizeSlug = (value) => String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '');
  const escapeRe = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const humanizeSlug = (slug) => slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');

  const getSlugFromUrl = (url) => {
    const m = String(url || '').match(slugFromPathRe);
    return m ? normalizeSlug(m[1]) : '';
  };

  const ensurePluginEntry = (slug, name) => {
    if (!slug) return null;
    if (!pluginEvidence[slug]) {
      pluginEvidence[slug] = {
        slug,
        name: name || knownPluginNames[slug] || humanizeSlug(slug),
        score: 0,
        evidence: new Set(),
      };
    } else if (!pluginEvidence[slug].name && name) {
      pluginEvidence[slug].name = name;
    }
    return pluginEvidence[slug];
  };

  const addEvidence = (slug, score, evidence, name) => {
    const entry = ensurePluginEntry(slug, name);
    if (!entry) return;
    entry.score = Math.min(100, entry.score + score);
    if (evidence) entry.evidence.add(evidence);
  };

  const allUrls = [
    ...Array.from(document.querySelectorAll('script[src]')).map(s => s.src),
    ...Array.from(document.querySelectorAll('link[href]')).map(l => l.href),
    ...Array.from(document.querySelectorAll('img[src]')).map(i => i.src),
    ...Array.from(document.querySelectorAll('iframe[src]')).map(i => i.src),
  ];

  const pathHit = new Set();
  for (const url of allUrls) {
    const slug = getSlugFromUrl(url);
    if (!slug || pathHit.has(slug)) continue;
    pathHit.add(slug);
    addEvidence(slug, 70, 'Asset path references /wp-content/plugins/');
  }

  const aliasHit = new Set();
  for (const url of allUrls) {
    const source = String(url || '').toLowerCase();
    for (const [needle, slug] of aliasRules) {
      const key = `${slug}:${needle}`;
      const boundedNeedle = new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`);
      if (boundedNeedle.test(source) && !aliasHit.has(key)) {
        aliasHit.add(key);
        addEvidence(slug, 35, `Matched plugin fingerprint: ${needle}`);
      }
    }
  }

  try {
    const resourceEntries = performance.getEntriesByType('resource').map(e => e.name);
    const resourceHit = new Set();
    for (const resourceUrl of resourceEntries) {
      const slug = getSlugFromUrl(resourceUrl);
      if (!slug || resourceHit.has(slug)) continue;
      resourceHit.add(slug);
      addEvidence(slug, 20, 'Runtime network request from plugin directory');
    }
  } catch (_) {}

  const signatureRules = [
    { slug: 'woocommerce', score: 40, evidence: 'WooCommerce globals/classes detected', test: () => !!(window.wc_add_to_cart_params || document.querySelector('.woocommerce, .woocommerce-page')) },
    { slug: 'elementor', score: 40, evidence: 'Elementor globals/markup detected', test: () => !!(window.elementorFrontendConfig || document.querySelector('[data-elementor-type], .elementor-section')) },
    { slug: 'contact-form-7', score: 40, evidence: 'Contact Form 7 globals/markup detected', test: () => !!(window.wpcf7 || document.querySelector('.wpcf7')) },
    { slug: 'wordpress-seo', score: 30, evidence: 'Yoast SEO generator metadata detected', test: () => !!document.querySelector('meta[name="generator"][content*="Yoast"]') },
    { slug: 'rank-math', score: 30, evidence: 'Rank Math metadata/class detected', test: () => !!document.querySelector('[class*="rank-math"], script[src*="rank-math"], link[href*="rank-math"], meta[name="rank-math-primary-category"]') },
    { slug: 'wp-rocket', score: 30, evidence: 'WP Rocket marker detected', test: () => /(?:wp-rocket|rocket-lazy-load|data-rocket)/i.test(document.documentElement.outerHTML.slice(0, 120000)) },
    { slug: 'wordfence', score: 30, evidence: 'Wordfence marker detected', test: () => /wordfence/i.test(bodyClasses) || !!document.querySelector('script[src*="wordfence"], link[href*="wordfence"]') },
  ];
  for (const sig of signatureRules) {
    try {
      if (sig.test()) addEvidence(sig.slug, sig.score, sig.evidence);
    } catch (_) {}
  }

  const pluginInsights = Object.values(pluginEvidence)
    .map(entry => {
      const confidence = Math.max(0, Math.min(100, Math.round(entry.score)));
      return {
        slug: entry.slug,
        name: entry.name || knownPluginNames[entry.slug] || humanizeSlug(entry.slug),
        confidence,
        level: confidence >= 80 ? 'Detected' : confidence >= 50 ? 'Likely' : 'Possible',
        evidence: Array.from(entry.evidence).slice(0, 3),
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 30);

  result.pluginInsights = pluginInsights;
  result.plugins = pluginInsights.map(p => p.name);

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
  result.duplicateIdDetails = Object.entries(idMap)
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 40);

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

function scrollToDuplicateId(targetId) {
  if (!targetId) return 'missing-id';
  const exact = document.getElementById(String(targetId));
  if (!exact) return 'not-found';

  exact.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const prevOutline = exact.style.outline;
  const prevBg = exact.style.backgroundColor;
  exact.style.outline = '2px solid #ef4444';
  exact.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
  setTimeout(() => {
    exact.style.outline = prevOutline;
    exact.style.backgroundColor = prevBg;
  }, 2000);

  return 'scrolled';
}
