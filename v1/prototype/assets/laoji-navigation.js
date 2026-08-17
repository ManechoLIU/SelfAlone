(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    api.__createForTests = factory;
    module.exports = api;
  }
  if (root) root.LaojiNavigation = api;
})(typeof window !== 'undefined' ? window : null, function (root, dependencies) {
  'use strict';

  const GLOBAL_NAV_STORAGE_KEY = 'laoji-global-nav-expanded';
  const PREVIEW_SCOPE_RECOVERY_MESSAGE = '预览权限已失效，当前页面已保留。请在「设计文件」中重新打开目标页面。';
  const PREVIEW_SCOPE_PATH_RE = /^\/api\/projects\/[^/]+\/preview\/[^/]+\//;

  function parseUrl(value, base) {
    try { return new URL(value, base); }
    catch (_) { return null; }
  }

  function toStablePreviewUrl(value) {
    const url = parseUrl(value);
    return url ? url.href : value;
  }

  function resolvePrototypeUrl(target, currentHref) {
    const current = parseUrl(currentHref);
    const resolved = parseUrl(target, current?.href || currentHref);
    if (!resolved) return target;
    return resolved.href;
  }

  function isScopedPreviewUrl(value) {
    const url = parseUrl(value);
    return Boolean(url && /^https?:$/.test(url.protocol) && PREVIEW_SCOPE_PATH_RE.test(url.pathname));
  }

  function createPreviewScopeProbeUrl(destination) {
    if (!isScopedPreviewUrl(destination)) return null;
    return parseUrl('assets/laoji.css', destination)?.href || null;
  }

  function loadStylesheetProbe(probeUrl) {
    const parent = root?.document?.head || root?.document?.documentElement;
    if (!parent || !probeUrl) return Promise.resolve(false);
    return new Promise(function (resolve) {
      const link = root.document.createElement('link');
      let settled = false;
      let timeoutId = null;
      function finish(valid) {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) root.clearTimeout?.(timeoutId);
        link.remove?.();
        resolve(Boolean(valid));
      }
      link.rel = 'stylesheet';
      link.media = 'not all';
      link.href = probeUrl;
      link.dataset.previewScopeProbe = '';
      link.addEventListener('load', function () { finish(true); }, { once: true });
      link.addEventListener('error', function () { finish(false); }, { once: true });
      if (root.setTimeout) timeoutId = root.setTimeout(function () { finish(false); }, 2500);
      parent.appendChild(link);
    });
  }

  const previewScopeProbe = dependencies?.previewScopeProbe || loadStylesheetProbe;

  async function verifyPreviewDestination(destination, probeImpl) {
    if (!isScopedPreviewUrl(destination)) return true;
    const probeUrl = createPreviewScopeProbeUrl(destination);
    if (!probeUrl || typeof probeImpl !== 'function') return false;
    try {
      return Boolean(await probeImpl(probeUrl));
    } catch (_) {
      return false;
    }
  }

  function showPreviewScopeRecovery(destination) {
    if (!root?.document?.body) return false;
    let notice = root.document.getElementById('preview-scope-recovery');
    if (!notice) {
      notice = root.document.createElement('div');
      notice.id = 'preview-scope-recovery';
      notice.className = 'toast';
      notice.dataset.odId = 'preview-scope-recovery';
      notice.setAttribute('role', 'alert');
      notice.setAttribute('aria-live', 'assertive');
      notice.setAttribute('aria-atomic', 'true');
      root.document.body.appendChild(notice);
    }
    notice.textContent = PREVIEW_SCOPE_RECOVERY_MESSAGE;
    notice.dataset.destination = destination || '';
    notice.classList.add('is-visible');
    if (root.setTimeout) {
      root.clearTimeout?.(showPreviewScopeRecovery.timer);
      showPreviewScopeRecovery.timer = root.setTimeout(function () {
        notice.classList.remove('is-visible');
      }, 8000);
    }
    return true;
  }

  function commitNavigation(destination, options) {
    if (options?.replace) root.location.replace(destination);
    else if (typeof root.location.assign === 'function') root.location.assign(destination);
    else root.location.href = destination;
  }

  async function go(target, options) {
    if (!root?.location) return target;
    const destination = resolvePrototypeUrl(target, root.location.href);
    const destinationIsValid = await verifyPreviewDestination(destination, previewScopeProbe);
    if (!destinationIsValid) {
      showPreviewScopeRecovery(destination);
      return null;
    }
    commitNavigation(destination, options);
    return destination;
  }

  function isPlainInternalPageClick(event, anchor) {
    if (!anchor || event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return false;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || /^(?:mailto:|tel:|javascript:)/i.test(href)) return false;
    const destination = parseUrl(href, root.location.href);
    return Boolean(destination && destination.origin === root.location.origin && /\.html?$/i.test(destination.pathname));
  }

  function readGlobalNavExpanded() {
    try { return root.localStorage.getItem(GLOBAL_NAV_STORAGE_KEY) === 'true'; }
    catch (_) { return false; }
  }

  function writeGlobalNavExpanded(expanded) {
    try { root.localStorage.setItem(GLOBAL_NAV_STORAGE_KEY, String(expanded)); }
    catch (_) { /* The shell still works when storage is unavailable. */ }
  }

  function restoreGlobalNavigationLayout(expanded) {
    const documentElement = root?.document?.documentElement;
    if (!documentElement?.dataset) return false;
    const value = String(Boolean(expanded));
    documentElement.dataset.globalNavExpanded = value;
    if (root.document.body) root.document.body.dataset.globalNavExpanded = value;
    return true;
  }

  function setGlobalNavigationExpanded(expanded, toggle) {
    if (!root?.document) return false;
    const nextExpanded = Boolean(expanded);
    restoreGlobalNavigationLayout(nextExpanded);
    if (toggle) {
      const label = nextExpanded ? '收起主导航' : '展开主导航';
      toggle.setAttribute('aria-expanded', String(nextExpanded));
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    }
    writeGlobalNavExpanded(nextExpanded);
    return nextExpanded;
  }

  function initGlobalNavigation() {
    if (!root?.document?.body) return null;
    const sideNav = root.document.querySelector('.side-nav');
    if (!sideNav) return null;
    const primaryNav = sideNav.querySelector('.nav-list');
    if (!primaryNav) return null;

    if (!primaryNav.id) primaryNav.id = 'laoji-primary-navigation';
    let toggle = sideNav.querySelector('[data-global-nav-toggle]');
    const legacyToggle = sideNav.querySelector('[data-ppt-nav-toggle]');
    if (!toggle && legacyToggle) {
      toggle = legacyToggle;
      toggle.removeAttribute('data-ppt-nav-toggle');
      toggle.classList.remove('ppt-nav-toggle');
    }
    if (!toggle) {
      toggle = root.document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'icon-btn global-nav-toggle';
      toggle.dataset.odId = 'global-nav-toggle';
      toggle.append(root.document.createElement('span'));
    }
    toggle.dataset.globalNavToggle = '';
    toggle.classList.add('global-nav-toggle');
    toggle.setAttribute('aria-controls', primaryNav.id);
    toggle.firstElementChild?.setAttribute('aria-hidden', 'true');
    sideNav.append(toggle);

    setGlobalNavigationExpanded(readGlobalNavExpanded(), toggle);
    toggle.addEventListener('click', function () {
      setGlobalNavigationExpanded(root.document.body.dataset.globalNavExpanded !== 'true', toggle);
    });
    return toggle;
  }

  function install() {
    if (!root?.location || !root?.document) return false;
    restoreGlobalNavigationLayout(readGlobalNavExpanded());
    if (!root.document.body) {
      root.document.addEventListener('DOMContentLoaded', install, { once: true });
      return true;
    }
    initGlobalNavigation();
    root.document.addEventListener('click', function (event) {
      const anchor = event.target?.closest?.('a[href]');
      if (!isPlainInternalPageClick(event, anchor)) return;
      event.preventDefault();
      go(anchor.getAttribute('href'));
    });
    return true;
  }

  if (root?.document) install();

  return {
    GLOBAL_NAV_STORAGE_KEY,
    PREVIEW_SCOPE_RECOVERY_MESSAGE,
    createPreviewScopeProbeUrl,
    go,
    initGlobalNavigation,
    install,
    isScopedPreviewUrl,
    resolvePrototypeUrl,
    restoreGlobalNavigationLayout,
    setGlobalNavigationExpanded,
    showPreviewScopeRecovery,
    toStablePreviewUrl,
    verifyPreviewDestination
  };
});
