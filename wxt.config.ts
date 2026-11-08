import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Glass Home',
    description: '本地优先的 Liquid Glass 风格主屏幕，时间、搜索、日历与快捷图标共享统一网格。',
    permissions: [],
    host_permissions: [],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';",
      sandbox: "sandbox allow-scripts; script-src 'self'; object-src 'none'; base-uri 'none'; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none';",
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
