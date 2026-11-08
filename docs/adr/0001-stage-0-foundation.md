# ADR-0001：阶段 0 技术基础与验证边界

- 状态：阶段 0 技术验证及视觉方向已确认；阶段 1 已实现并验收，等待用户检查
- 日期：2026-11-06
- 需求基线：`docs/product-baseline-v1.md` v1.0

## 决策

1. 项目从本机空目录启动，使用 WXT 0.21.5、React 19.3.1、TypeScript 7.0.2 和 pnpm。初始化时从 npm registry 查询并写入明确版本，随后以 lockfile 为准。
2. 首发只以 Chromium MV3 的新标签页为运行基线，使用 WXT `newtab` 入口，不重定向到远程网站。
3. 阶段 0 提供高保真可交互原型，不假装实现完整布局引擎、Widget 平台、搜索导航、CRUD 或用户设置持久化。
4. 四档材质与 10/8/5 列切换是临时验证面板控制，仅保存在 React 内存中，不能将其宣称为用户布局持久化。
5. 扩展基础权限为空；阶段 0 使用 IndexedDB，不申请 `storage`、书签、历史、定位、通知或任意主机权限。
6. sandbox 入口设置独立严格 CSP：禁止网络、对象、基址与动态执行；iframe 使用 `sandbox="allow-scripts"`，不附加 `allow-same-origin`。
7. opaque origin 的 sandbox 无法以固定 origin 做消息白名单。因此验证时使用 source window、一次性 nonce、运行时 schema 及超时；正式协议还需会话与实例授权映射。
8. 布局引擎放在 `src/domain/grid`，不依赖 React、DOM 或浏览器 API。阶段 0 只验证矩形与首个空位，不提前实现推挤算法。
9. UI 不引入组件框架，样式使用 CSS Modules/全局设计变量的渐进方式；目前原型使用 `src/styles/global.css`，组件化时再拆分。
10. `srcDir: '.'` 时保留 WXT 默认 `@ -> 项目根目录` 别名，使用 `@/src/...` 导入；不得把它覆盖为 `src`。
11. 因 Vite 8 与 WXT 构建方式组合下出现别名解析失败，本阶段固定 Vite 7.3.7、@vitejs/plugin-react 5.1.4 和 Vitest 4.1.12；后续升级需重新验证生产构建。

## 理由

- 官方 WXT 入口约定直接覆盖 newtab/sandbox 构建，减少手写构建脚本。
- 浏览器新标签页会优先聚焦地址栏，页面不主动抢焦点。
- Chrome 文档指出 sandbox 页面没有扩展 API、不能直接访问非 sandbox 页面，并需要单独的 CSP。默认值允许动态执行，必须显式收紧。
- 避免把“静态原型有网格”误认为“布局事务已实现”。

## 代价与后续

- WXT 升级会影响构建链，升级前需查看官方迁移说明和真实生产 manifest。
- 当前时间秒针只为验证等宽数字，后续根据用户设置和可见性按分钟/秒刷新。
- 当前壁纸是 CSS 生成渐变，未打包 Apple 专有壁纸、字体或品牌 SVG；后续替换为许可明确的正式资源。
- IndexedDB 是适配层技术验证，正式 Workspace 还需要 schema、revision、冲突与迁移测试。

## 依据

- WXT entrypoints：https://wxt.dev/guide/essentials/entrypoints
- WXT manifest：https://wxt.dev/guide/essentials/config/manifest
- Chrome 新标签页：https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages?hl=zh_cn
- Chrome sandbox：https://developer.chrome.com/docs/extensions/reference/manifest/sandbox?hl=zh-cn
- Chrome storage：https://developer.chrome.com/docs/extensions/reference/api/storage?hl=zh-cn
