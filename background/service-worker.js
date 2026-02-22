/* ============================================================
   WP Inspector — Background Service Worker (MV3)
   ============================================================ */

// ── Badge: mark WordPress tabs ────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('http')) return;

  // Quick URL-based guess first
  if (isLikelyWordPress(tab.url)) {
    setBadge(tabId, 'WP', '#21759b');
    return;
  }

  // Inject a tiny check into the page to confirm
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const body = document.body?.className || '';
        return !!(
          body.includes('wp-') ||
          document.querySelector('link[rel="https://api.w.org/"]') ||
          document.querySelector('meta[name="generator"][content*="WordPress"]') ||
          document.querySelector('link[href*="/wp-content/"]') ||
          document.querySelector('script[src*="/wp-includes/"]')
        );
      },
    });
    if (res?.result) {
      setBadge(tabId, 'WP', '#21759b');
    } else {
      clearBadge(tabId);
    }
  } catch (_) {
    // Non-injectable tab (chrome://, extensions page, etc.) — ignore
    clearBadge(tabId);
  }
});

// ── Message handler (from popup) ─────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.action === 'open_tab' && msg.url) {
    chrome.tabs.create({ url: msg.url });
    reply({ ok: true });
  }
  return true;
});

// ── Helpers ───────────────────────────────────────────────
function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

function clearBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' });
}

function isLikelyWordPress(url) {
  return (
    url.includes('/wp-content/') ||
    url.includes('/wp-admin/') ||
    url.includes('/wp-login')
  );
}
