# 阶段 3 验证记录：Widget 平台

日期：2026-11-09
环境：macOS，Microsoft Edge 157.0.4341.42；Chrome / Windows / Firefox / Safari 未实测
起始基线：`93d708e`（阶段 3-A/B 提交前）
结论：**实现完成并通过自测，等待用户检查确认**

## 1. 交付内容

**内置待办组件（3-A）**
- `domain/widget/todo.ts`：纯函数领域层，增删改、完成、排序、50 条上限、120 字符上限、防御性解析。
- `infrastructure/persistence/widgetStorage.ts`：按 `storageNamespace` 隔离的实例存储，256 KB 配额。
- `features/widget/TodoWidget.tsx`：键盘可操作（回车提交、复选框原生语义）、空状态、超限提示。

**Widget 宿主与隔离（3-B）**
- `features/widget/WidgetFrame.tsx`：错误边界只包 Widget 子树，崩溃渲染错误卡片并保留网格位置。
- `features/widget/WidgetHost.tsx`：统一分发内置组件，未知/禁用实例给明确错误卡片。
- `domain/widget/environment.ts`：主题/语言/尺寸/reducedMotion/材质 下发。

**沙箱消息通道（3-C）**
- `domain/widget/bridge.ts`：桥接协议（版本化信封、错误码、大小预算）。
- `infrastructure/widget-host/bridgeRouter.ts`：宿主侧路由，DOM 无关，安全规则可单测。
- `infrastructure/widget-host/sandboxSession.ts`：与真实 iframe 对接的适配层。
- `features/settings/SandboxDemo.tsx`：设置「数据」页内的开发示例，可视化通道连通。

## 2. 关键决策

**(a) 待办数据不进 Workspace。** 勾选复选框若走 Workspace 提交，会 bump revision 并压入布局撤销栈——勾选一件事就变成一次"布局操作"，语义错误。故使用独立 `widget-data` object store，key 为 `${namespace}:${key}`。

**(b) 数据库 v2 → v3。** 新增 `widget-data` store，`upgradeneeded` 按 `oldVersion` 增量创建，不重建已有 store。

**(c) v1 → v2 工作区迁移（本轮最大风险）。** v2 校验要求每个内置 id 存在于三个断点；直接加入待办会把所有老用户送进恢复页。`domain/workspace/migration.ts` 做增量迁移（只追加实例与各断点一个布局项），`load()` 中**先迁移再校验并写回**。未知未来版本拒绝而非降级。

**(d) 默认布局必须不挤动已验收构图。** 初版把待办放在 `(6,2)`，把 20 个快捷方式整体下推一行，`github` 从 `(0,3)` 变 `(0,4)`，导致 2A 用例中 `(1,3)` 从"交换"变"移动"。已改为与迁移同规则的 `findFirstFit`，把待办追加到所有既有对象之后（10 列落在 `(0,5)`）。**既有对象一个都不动。**

## 3. 修复的真实缺陷

**(a) 沙箱协议方向写反。** 初版让宿主发请求、沙箱应答，而路由又校验"沙箱发来的请求"，两者矛盾，握手始终失败（实测面板停在"正在请求…"）。基线 10.6 定义的是 Widget 请求宿主，已改为沙箱发起、宿主应答。

**(b) 待办面板溢出压住下方图标。** 缺 `overflow` 裁剪，面板内容顶出网格单元覆盖快捷方式。

**(c) "清除已完成"渲染成白块。** 误用固定 28px 的 `.mini-button`，文字被压成竖排；且继承全局 `button` 外观在玻璃表面呈白块。改为独立带边框样式。

**(d) 删除按钮长期不可见。** `opacity: 0` 加 hover 显现，是无障碍陷阱。改为常驻 0.45、交互时全亮。

## 4. 实际执行命令与结果

```
pnpm run typecheck  → exit 0
pnpm run test       → 20 files / 189 passed | 2 skipped (191)
pnpm run build      → 500.69 kB
pnpm run check      → 三阶段全绿
pnpm exec playwright test --repeat-each=2 → 74 passed (3.6m)
```

E2E：37 个用例 × 2 轮 = 74 次全通过。阶段 0/1/2A/2B 的既有用例全部保持通过。

## 5. 用例覆盖

| 能力 | 单测 | Edge E2E |
|---|---|---|
| 待办领域规则 | `todo.test.ts` 24 项 | — |
| 存储配额算术 | `widget-storage.test.ts` 9 项 | 待办持久化用例 |
| v1→v2 迁移 | `workspace-migration.test.ts` 12 项 | 重写存储为 v1 后刷新不落恢复页 |
| 沙箱路由安全 | `widget-bridge.test.ts` 17 项 | 伪造消息、错误实例 id、未开放能力 |
| 沙箱隔离 | — | 宿主侧跨源访问抛 `SecurityError`、`runtime.id` 不可达 |
| 待办 UI 行为 | — | 增删改、超限、清除、浏览器级重启 |

## 6. 测试自身的两处纠正

- **删除用例按位置定位导致偶发失败**（15 次中 1 次）：完成一项会重排列表，`.first()` 可能指向已被替换的元素。改为按 `data-todo-id` 定位后连续 5 轮稳定。这是测试缺陷，不是产品缺陷。
- **隔离用例曾用"沙箱自述"作证据**：沙箱告知自己 `blocked` 等于让它自证，已改为宿主侧访问失败作为证据。同样地，直接以顶层标签打开探针页会让 `window.parent === self`，隔离恒为"可访问"，已改回 iframe 嵌入。

## 7. 明确未完成 / 未验收

- **网络代理 / Permission Broker（基线 10.8）未实现**：需域名白名单授权流，属 P1。本轮**不开放任何网络能力**。
- **通知 / 书签 / 定位**未开放。
- **Widget 实例存储**未开放给沙箱（只开只读环境能力）。
- **Widget 市场、签名分发、版本迁移**（10.11）未实现，属 P2。
- **第三方 Widget 安装流程**未实现：当前只有硬编码的开发示例页，不能加载外部包。
- 刷新调度（10.9）、后台 alarms 未实现。
- 拖动/待办操作的**帧率未测量**；Chrome/Windows/Firefox/Safari 未实测。
- 完整屏幕阅读器流程未验收。

## 8. 证据

- `artifacts/e2e-results.json`：两轮完整回归报告。
- `/tmp/glass-home-shots/stage-3-todo-edge.png`：待办组件。
- `/tmp/glass-home-shots/stage-3-migrated-edge.png`：v1 数据升级后正常加载。
- `/tmp/glass-home-shots/stage-3-sandbox-edge.png`：沙箱通道连通。

## 9. 暂停确认

请在 Edge 加载 `.output/chrome-mv3` 后检查：

1. **待办组件**：主屏幕右侧应出现待办面板。输入内容回车添加，勾选完成，点 × 删除。刷新后内容仍在。
2. **不影响布局事务**：勾选待办后，顶部"撤销布局"仍应为禁用——待办不是布局操作。
3. **数据升级**：如果你之前用过旧版本，启动后应提示"本地数据已升级：新增内置待办组件"，且原有快捷方式位置不变。
4. **沙箱通道**：设置 → 数据 → 底部"沙箱组件通道"，应显示"已取得环境"，内嵌页列出主题/语言/尺寸。

确认后才进入阶段 4（首发加固）。
