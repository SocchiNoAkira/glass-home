# 阶段 0 验证记录：设计确认与技术风险验证

- 验证日期：2026-11-07（本机时间）
- 项目位置：`/Volumes/Cupcake/Workspace/glass-home`
- 状态：**技术验证已完成，等待用户确认视觉与阶段 0 结论**
- 范围：只验证扩展壳、视觉原型、基础网格原语、存储和 sandbox；不是产品功能完整实现

## 1. 本机环境

| 项目 | 实际环境 |
|---|---|
| 系统 | macOS 27.3，Darwin arm64 |
| Node.js | 24.19.0 |
| pnpm | 11.21.0 |
| 浏览器 | Microsoft Edge 156.0.4314.58 |
| 构建 | WXT 0.21.5 / Vite 7.3.7 / React 19.3.1 / TypeScript 7.0.2 |
| Chrome | 默认应用目录未发现，未实测 |
| Firefox / Safari | 未测试，不宣称支持 |

项目最初短暂创建于 `~/Developer/glass-home`，已按用户要求整体迁移到上述 Workspace 路径。旧路径已清空，`dsh`、`lite-md-viewer` 未改动。迁移后重新安装依赖并验证构建，证明新路径可独立工作。

## 2. 已实现与验证范围

1. WXT 本地 HTML `newtab` 入口与 MV3 生产包。
2. 高保真默认构图：大时钟、日期、搜索、20 个独立快捷图标、日历与 Widget 预览。
3. 临时设计面板：10/8/5 列、编辑外观、明暗与四档材质。
4. `Esc` 退出编辑态、进入编辑时收起验证面板；搜索框键盘提交仅在本地反馈，不发搜索请求。
5. `Grid` 矩形碰撞、边界、唯一实例和首个完整空位的基础纯函数。
6. IndexedDB 写入、重读、主动中止回滚与测试数据清理。
7. sandbox iframe 无父 DOM 和扩展 API 访问能力；source window、nonce、协议校验与超时。
8. Widget manifest、消息协议和布局事务的类型/状态机草案。

## 3. 实际执行的最终检查

在 `/Volumes/Cupcake/Workspace/glass-home` 中实际执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript `tsc --noEmit` | 通过 | 最终命令退出码 0 |
| Vitest | **2 个文件、9 项测试全部通过** | `tests/unit/grid.test.ts`、`tests/unit/protocol.test.ts` |
| WXT production build | 通过 | `.output/chrome-mv3`，约 291KB |
| Playwright + 本机 Edge | **6/6 通过，0 跳过，0 失败，0 flaky** | `artifacts/e2e-results.json` |
| 生产 Manifest | 通过 | `permissions: []`、`host_permissions: []` |
| 页面异常与外部请求 | 截图流程中均为 0 | `artifacts/stage-0-visual-report.json` |

### 3.1 Edge 用例明细

1. `chrome://newtab` 跳转到本地扩展页面，显示时钟和 20 个独立快捷图标，实际 10 列。
2. 5/8/10 列按实际像素列数验证；高/关闭材质有实际 CSS 差异；编辑态与 `Esc` 正常；深色/浅色切换及减少动态效果生效。
3. IndexedDB 提交、重读与主动中止回滚成功，未保留探针数据。
4. sandbox 父 DOM 隔离和扩展 API 不可用；生产清单无额外权限，sandbox CSP 禁止 `unsafe-eval` 和 `connect-src`。
5. 搜索框键盘提交与空输入反馈在本地完成，不发生导航。
6. 390×844 视口下 5 列和 20 个图标保留，未出现横向溢出。

### 3.2 真实截图

| 文件 | 内容 |
|---|---|
| `artifacts/stage-0-default-edge.png` | 深色均衡材质、10 列默认主屏幕 |
| `artifacts/stage-0-inspector-edge.png` | 设计验证面板与材质选项 |
| `artifacts/stage-0-light-solid-edge.png` | 浅色、关闭材质的实体高对比度表面 |
| `artifacts/stage-0-edit-low-edge.png` | 8 列、低材质与编辑外观 |
| `artifacts/stage-0-narrow-edge.png` | 390×844、8 列窄窗口适配 |

截图使用独立 Edge 测试 profile 加载生产扩展，通过浏览器 CDP 接口获取。功能回归使用 `chrome://newtab` 验证真实覆盖；视觉取证使用对应本地扩展 URL 截取页面，二者不混为同一种证据。

## 4. 过程中发现并修复的问题

1. WXT React 模块应使用 `modules: ['@wxt-dev/module-react']`，不是函数调用形式。
2. TypeScript 7 移除 `baseUrl`，且需明确 `jsx: react-jsx`。
3. `srcDir: '.'` 下 WXT 的 `@` 指向项目根目录；统一使用 `@/src/...`，避免覆盖内置别名。
4. Vite 8 与 WXT 构建方式组合下别名解析失败。固定 Vite 7.3.7、`@vitejs/plugin-react` 5.1.4 与 Vitest 4.1.12；通过 pnpm workspace override 统一子依赖。
5. pnpm 11 的 overrides 位于 `pnpm-workspace.yaml`；只为官方 `esbuild` 包允许安装脚本。
6. Edge 没有 background worker 时不能靠 Service Worker 发现扩展 ID，改为读取独立测试 profile 的真实新标签页注册。
7. Playwright 默认点击稳定性等待在当前 Edge/扩展页组合中间歇性阻塞；显式验证可见、可用、布局框后使用真实鼠标输入，未修改产品按钮迎合测试。
8. 进入编辑模式自动关闭验证面板，避免第一次 `Esc` 只关闭面板造成状态歧义。
9. sandbox 消息必须在 iframe load 后发送；以 request ID 丢弃过期响应，避免重复请求。

## 5. 明确未完成与未验收

- 没有实现真实搜索/网址导航、快捷图标 CRUD、拖动/交换/推挤、完整布局事务、Widget 产品功能、设置持久化、数据导入导出、多标签页 revision 冲突。
- 当前网格和材质选择只是临时 React 状态，刷新后恢复默认；不是用户布局持久化。
- 壁纸为 CSS 生成，快捷图标是字母/符号回退原型，天气为标注 P1 的静态预览。
- 尚未完成全部壁纸组合的 WCAG 对比度测量、屏幕阅读器人工检查、首屏性能测量和连续拖动帧率测试。
- 高材质只是 Web 视觉近似，不包含高成本真实折射，也不声称原生逐像素一致。
- Chrome、Firefox、Safari 未实测；不能把 Chromium 构建或 Edge 通过扩展为跨浏览器承诺。
- 完整首屏、多窗口/手动恢复和 Service Worker 休眠路径尚未验收，本阶段没有 background worker。

## 6. 建议用户确认

1. 默认构图、渐变壁纸、字号和 Liquid Glass 层级是否符合方向。
2. 是否保留 10/8/5 列、编辑外观和四档材质为产品方向。
3. 是否按既定边界进入阶段 1：本地时钟/日历、搜索、快捷图标 CRUD、Workspace 持久化与设置。

未收到确认前不进入阶段 1。
