const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypeDir = path.join(__dirname, '..');
const navigationPath = path.join(prototypeDir, 'assets', 'laoji-navigation.js');
const navigation = require(navigationPath);

const previewUrl = 'http://127.0.0.1:51434/api/projects/project-1/preview/scope-1/prototype/laoji-epub-reader.html?view=reading#page-2';
const stableCurrentUrl = navigation.toStablePreviewUrl(previewUrl);
assert.equal(
  stableCurrentUrl,
  previewUrl,
  '预览页必须保留宿主签发的 scope，不能改写到需要工作区上下文的 raw 路由'
);

assert.equal(
  navigation.resolvePrototypeUrl('laoji-settings.html?tab=ai#connection', previewUrl),
  'http://127.0.0.1:51434/api/projects/project-1/preview/scope-1/prototype/laoji-settings.html?tab=ai#connection',
  '跨页导航应留在同一个有效 preview scope 内，并保留页面参数与锚点'
);

assert.ok(
  !navigation.resolvePrototypeUrl('laoji-library.html', previewUrl).includes('/raw/'),
  '原型导航不得进入会触发 WORKSPACE_CONTEXT_REQUIRED 的 raw 路由'
);

assert.equal(
  navigation.toStablePreviewUrl('file:///tmp/prototype/laoji-chat.html'),
  'file:///tmp/prototype/laoji-chat.html',
  '普通文件预览不得被改写'
);

assert.equal(
  navigation.isScopedPreviewUrl(previewUrl),
  true,
  '共享导航必须识别 Open Design 的受限 preview scope'
);
assert.equal(
  navigation.isScopedPreviewUrl('http://127.0.0.1:41731/prototype/laoji-chat.html'),
  false,
  '普通本地预览不应进入 scope 探测流程'
);

(async () => {
  let probes = 0;
  const expectedProbeUrl = 'http://127.0.0.1:51434/api/projects/project-1/preview/scope-1/prototype/assets/laoji.css';
  assert.equal(
    navigation.createPreviewScopeProbeUrl(previewUrl),
    expectedProbeUrl,
    'scope 探测必须使用同一 scope 下的已知样式资源'
  );
  assert.equal(
    await navigation.verifyPreviewDestination(previewUrl, async (probeUrl) => {
      probes += 1;
      assert.equal(probeUrl, expectedProbeUrl, 'scope 探测不得请求目标 HTML 整页');
      return true;
    }),
    true,
    '有效 scope 才允许继续跨页导航'
  );
  assert.equal(probes, 1, '有效 scope 只探测一次');

  assert.equal(
    await navigation.verifyPreviewDestination(previewUrl, async () => false),
    false,
    '宿主返回 PREVIEW_SCOPE_NOT_FOUND 时必须留在当前页面'
  );
  assert.equal(
    await navigation.verifyPreviewDestination(previewUrl, async () => { throw new Error('Stylesheet probe failed'); }),
    false,
    '样式资源探测失败时必须安全停止导航'
  );
  assert.equal(
    await navigation.verifyPreviewDestination('http://127.0.0.1:41731/prototype/laoji-chat.html'),
    true,
    '普通本地预览无需 scope 探测即可导航'
  );

  const navigationSource = fs.readFileSync(navigationPath, 'utf8');
  assert.match(
    navigationSource,
    /await verifyPreviewDestination\(destination, previewScopeProbe\)/,
    'go 必须在提交 scoped preview 导航前执行有效性探测'
  );
  assert.doesNotMatch(
    navigationSource,
    /\bfetch\s*\(/,
    "preview CSP 禁止 connect-src，scope 探测不得依赖 fetch"
  );
  assert.match(
    navigationSource,
    /showPreviewScopeRecovery\(destination\)/,
    'scope 失效时必须提供明确恢复提示，不能落入整页 JSON 错误'
  );

  const createNavigation = navigation.__createForTests;
  assert.equal(typeof createNavigation, 'function', '共享导航必须允许隔离验证提交导航前的 scope 守卫');
  let assignedDestination = null;
  const expiredNavigation = createNavigation({
    location: {
      href: previewUrl,
      assign(value) { assignedDestination = value; },
      replace(value) { assignedDestination = value; }
    }
  }, {
    previewScopeProbe: async () => false
  });
  assert.equal(
    await expiredNavigation.go('laoji-settings.html'),
    null,
    '失效 scope 的 go 必须明确返回未导航状态'
  );
  assert.equal(assignedDestination, null, '失效 scope 绝不能提交 location 导航');

  const noticeElements = new Map();
  const recoveryRoot = {
    location: {
      href: previewUrl,
      assign(value) { assignedDestination = value; },
      replace(value) { assignedDestination = value; }
    },
    document: {
      body: {
        dataset: {},
        appendChild(element) { noticeElements.set(element.id, element); }
      },
      documentElement: {},
      querySelector() { return null; },
      addEventListener() {},
      getElementById(id) { return noticeElements.get(id) || null; },
      createElement() {
        const classes = new Set();
        return {
          dataset: {},
          classList: {
            add(value) { classes.add(value); },
            remove(value) { classes.delete(value); },
            contains(value) { return classes.has(value); }
          },
          attributes: {},
          setAttribute(name, value) { this.attributes[name] = String(value); }
        };
      }
    },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  const recoveryNavigation = createNavigation(recoveryRoot, { previewScopeProbe: async () => false });
  await recoveryNavigation.go('laoji-settings.html');
  const recoveryNotice = noticeElements.get('preview-scope-recovery');
  assert.ok(recoveryNotice, 'scope 失效时必须在当前页面创建恢复提示');
  assert.equal(recoveryNotice.attributes.role, 'alert', '恢复提示必须立即向辅助技术播报');
  assert.equal(recoveryNotice.attributes['aria-live'], 'assertive', '恢复提示必须使用明确的错误播报优先级');
  assert.equal(recoveryNotice.textContent, navigation.PREVIEW_SCOPE_RECOVERY_MESSAGE, '恢复提示必须说明当前页面已保留及重新打开路径');
  assert.equal(recoveryNotice.classList.contains('is-visible'), true, '恢复提示必须可见');

  const validNavigation = createNavigation({
    location: {
      href: previewUrl,
      assign(value) { assignedDestination = value; },
      replace(value) { assignedDestination = value; }
    }
  }, {
    previewScopeProbe: async () => true
  });
  const expectedDestination = 'http://127.0.0.1:51434/api/projects/project-1/preview/scope-1/prototype/laoji-library.html';
  assert.equal(await validNavigation.go('laoji-library.html'), expectedDestination, '有效 scope 应保持原有跨页目标');
  assert.equal(assignedDestination, expectedDestination, '有效 scope 探测通过后才可提交 location 导航');

  const pages = fs.readdirSync(prototypeDir).filter((name) => name.endsWith('.html')).sort();
  for (const page of pages) {
    const html = fs.readFileSync(path.join(prototypeDir, page), 'utf8');
    const navigationIndex = html.indexOf('assets/laoji-navigation.js');
    const appIndex = html.indexOf('assets/laoji.js');
    assert.ok(navigationIndex >= 0, `${page} 必须加载共享预览导航脚本`);
    assert.ok(appIndex < 0 || navigationIndex < appIndex, `${page} 必须先加载预览导航脚本再加载主交互脚本`);
  }

  const appScript = fs.readFileSync(path.join(prototypeDir, 'assets', 'laoji.js'), 'utf8');
  assert.ok(!/window\.location\.href\s*=/.test(appScript), '主交互脚本不得绕过共享导航直接切换页面');
  console.log(`laoji-preview-scope-navigation: ${pages.length} pages passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
