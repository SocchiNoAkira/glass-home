import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Glass Home',
    description: '本地优先的 Liquid Glass 风格主屏幕，时间、搜索、日历与快捷图标共享统一网格。',
    // `favicon` reads only cached site icons. `storage`, `alarms` and
    // `notifications` power the local reminder widget without a server.
    permissions: ['favicon', 'storage', 'alarms', 'notifications'],
    host_permissions: [],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';",
      // `'unsafe-inline'` is required here and only here.
      //
      // A page listed under `sandbox.pages` runs with a unique (opaque) origin,
      // so `script-src 'self'` matches nothing and the bundled chunk is blocked
      // *silently* — the tag is present, the file is whole, but it never runs.
      // (Verified in Edge 157: the sandbox status text stayed at its initial
      // value, and only inline injections reported a violation.)
      //
      // The blast radius is contained by the page's own isolation: it is loaded
      // with `sandbox="allow-scripts"` (no `allow-same-origin`), so it cannot
      // reach the parent DOM, extension APIs or any origin-bound storage. The
      // policy still forbids network access, objects and non-self assets.
      sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none';",
    },
    browser_specific_settings: {
      gecko: {
        id: 'glass-home@local.dev',
        strict_min_version: '140.0',
      },
    },
  },
  webExt: {
    disabled: true,
  },
});
