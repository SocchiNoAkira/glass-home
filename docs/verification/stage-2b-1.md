# 阶段 2B-1 验证记录：Pointer 拖放与键盘布局操作

日期：2026-11-09
环境：macOS，Microsoft Edge 157.0.4341.42，Chrome / Windows / Firefox / Safari 未实测
基线提交：`56f43b8`（阶段 2A 验收态）
结论：**实现完成并通过自测，等待用户检查确认**；阶段 2B-2 未授权，未实施。

## 1. 本轮改动

新增：

| 文件 | 作用 |
|---|---|
| `src/features/grid/useGridDrag.ts` | 指针拖放会话：6px 阈值、一次测量、命中解析、预览/提交生命周期、Esc 与 `pointercancel` 回滚 |
| `src/features/grid/useGridKeyboard.ts` | 方向键移动、`Alt+方向键` 调整尺寸、提交后按 `instanceId` 恢复焦点 |
| `src/styles/stage-2b-1.css` | ghost、目标格轮廓、插入线、拖动中网格、`reduced-motion` 覆盖 |
| `tests/unit/drag-geometry.test.ts` | 命中与格距算术（9 项） |
| `tests/unit/drag-intent.test.ts` | 三意图解析、签名去重、命令映射（15 项） |
| `tests/unit/keyboard-layout.test.ts` | 方向键目标、边界、锁定、尺寸约束（10 项） |
| `tests/e2e/stage-2b-layout.spec.ts` | 拖动与键盘真实 Edge 用例（5 项） |
| `tests/e2e/stage-2b-feedback.spec.ts` | 拖动反馈计算样式取证（1 项） |
| `tests/e2e/stage-2b-visual.spec.ts` | 拖动中间态截图（1 项） |

修改：

- `src/features/grid/HomeGrid.tsx`：容器层事件委托接入拖放与键盘，新增 `DragOverlay`，网格项增加 `data-locked` 与 `tabIndex`。
- `src/features/home/App.tsx`：接入 `onPreviewLayout` / `onCommitLayout` / `onCancelLayout`；新增 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`（跳过输入框）；编辑态与普通态文案更新。
- `entrypoints/newtab/main.tsx`：引入 `stage-2b-1.css`。

未改动（刻意保持）：`dragGeometry.ts`、`dragIntent.ts`、`keyboardLayout.ts`、`gridMetrics.ts`、`pointerIntent.ts`、`occupancy.ts`、`solver.ts`、`domain/layout/transaction.ts`、`workspaceStore.ts`。

## 2. 关键实现决策

**拖放接入点在 `HomeGrid` 容器层，而非逐个图标。** `ShortcutIcon` 原有的 `pointerStart` / `dragged` 只用于抑制误导航，没有拖放入口。容器层委托可以复用一次 `data-instance-id` 查找，并让 Widget 与快捷方式共享同一套命中逻辑。

**拖动开始时的布局快照必须固定。** 预览会实时改写网格，若每次命中都读当前布局，目标会跟着自己的重排漂移。因此 `DragSession.layout` 在 `pointerdown` 固化，命中解析一律基于该快照。

**测量只在越过阈值时执行一次。** 符合 `gridMetrics.ts` 的设计说明与产品基线 6.2「只有目标格变化时才重新计算」。指针在同一格内抖动由 `intentSignature` 去重拦截，不会反复触发求解器。

**拖到原位不是事务。** `createLayoutPreview` 对无变化返回 `blocked`，若不去重会弹出「目标位置没有变化」。拖到原点时直接取消预览、不产生历史。

**锁定对象提前拒绝。** `pointerdown` 阶段即跳过 `locked` 项，不进入拖放状态机，避免把一个注定被求解器拒绝的操作变成错误提示。

## 3. 修复的两个真实缺陷

**(a) 拖拽后残留的点击抑制会误吞无关点击。** 首轮 E2E 中「撤销布局」点击无响应，持久化布局未回滚。原因是 Chromium 在一次多步拖拽后不总派发 `click`，用于抑制误导航的标志位一直悬着，把下一次无关的 UI 点击吃掉。已改为：抑制仅作用于落在网格内部的点击，且任何新的 `pointerdown` 都会清零。修复后该用例通过，且这是产品层修复，不是放宽断言。

**(b) 单测暴露的三个纯函数层此前零覆盖。** `dragGeometry`、`dragIntent`、`keyboardLayout` 是 2B-1 的全部核心逻辑，此前 9 个测试文件完全未触及。已补 34 项测试，测试总数由 52 增至 86。

## 4. 实际执行命令与结果

```
pnpm run typecheck        → exit 0（无输出）
pnpm run test             → Test Files 12 passed (12) / Tests 86 passed (86)
pnpm run build            → Built extension in 2.320s，Σ Total size 470.35 kB
pnpm run check            → 三阶段全绿
pnpm exec playwright test --repeat-each=2  → 50 passed (3.3m)
```

E2E 为 25 个用例 × 2 轮 = 50 次执行，全部通过，零失败零跳过。其中阶段 1 与 2A 的既有 22 个用例（×2=44）全部保持通过，证明本轮改动未破坏已验收行为。

## 5. 用例覆盖矩阵

| 计划项 | 覆盖证据 |
|---|---|
| 拖动启动：6px 阈值、拖动期间不导航 | `stage-2b-layout:45`（普通模式直拖，URL 保持 `newtab.html`）；`pointer-intent.test.ts`（既有） |
| 命中解析：一次测量 → 移动/交换/插入 | `drag-geometry.test.ts` 9 项 + `drag-intent.test.ts` 15 项；`stage-2b-feedback`（三种意图的边框样式与标签实测） |
| 拖动反馈：ghost、轮廓、插入线、过渡 | `stage-2b-feedback`：`opacity>0`、宽高>20px、`solid`/`dashed`、`::before` 插入线、`zIndex>=6`、拖动中 `transform` |
| 事务化：只预览、松手提交、Esc 回滚不落盘 | `stage-2b-layout:45`（按住未松手时持久化数据完全不变）；`:81`（松手后 revision+1 且可撤销） |
| 连续拖动：旧结果不覆盖 | `stage-2b-layout:124`（连续两次交换往返回到原位，无残留 overlay） |
| 键盘：方向键、Alt+方向键、焦点留原对象、Esc | `stage-2b-layout:152`（移动后 `data-grid-x` 变更、`document.activeElement` 仍为该对象、撤销可回滚、1×1 与 Widget 尺寸各自验证）；`keyboard-layout.test.ts` 10 项 |
| 锁定对象不可拖动 / 不可键盘移动 | `stage-2b-layout:195`（拖动不进入会话、方向键不改变坐标、持久化不变） |

边界验证：拖动只改目标断点（`:81` 断言 8 列与 5 列布局不变）；撤销历史不跨刷新（`:81` 刷新后撤销按钮 `disabled`）。

## 6. 证据

- `artifacts/stage-2b-drag-swap-edge.png`：普通模式交换预览（ghost + 目标格）。
- `artifacts/stage-2b-drag-insert-edge.png`：间隙插入预览（虚线 + 插入线）。
- `artifacts/stage-2b-drag-edit-mode-edge.png`：编辑模式拖动。
- `artifacts/e2e-results.json`：两轮完整回归报告。

**说明**：本轮截图已生成且用例通过，但当时 LobeHub 文件库报 `storage_block: upgrade_required`，我无法查看图片内容。因此改用 `stage-2b-feedback.spec.ts` 对计算样式做机器断言，替代人工视觉确认。截图的视觉美观度、颜色对比度仍需你人工检查。

## 7. 明确未完成 / 未验收

- 局部/全局智能整理、10/8/5 列独立布局编排、多页面 `expectedRevision` 冲突处理：属 2B-2，未授权未实施。
- Widget 尺寸拖拽手柄：`Alt+方向键` 已提供键盘尺寸调整，但指针拖拽改变尺寸未实现（属 2B-2 尺寸手柄）。
- 拖动性能未做帧率测量；产品基线 10.x 的 60fps 目标与持续拖动长任务检测尚未验收。
- 完整屏幕阅读器流程、跨浏览器（Chrome/Windows/Firefox/Safari）均未实测。
- 截图的人工视觉评审未完成（见第 6 节原因）。

## 8. 暂停确认

请在 Edge 加载 `.output/chrome-mv3` 后检查：

1. **普通模式直接拖动**快捷图标到另一图标上（交换）、拖到空白格（移动）、拖到图标之间的缝隙（插入推挤）；按住时布局应只变预览，松开才保存。
2. 拖动过程中按 **Esc**：应回到原位且不写入本地。
3. 进入编辑模式后，**Tab 选中**一个图标，按 **方向键**移动、**Alt+方向键**改尺寸，确认焦点仍在该对象上、`Ctrl/Cmd+Z` 可撤销。
4. 锁定一个对象后再尝试拖动与方向键，应完全无反应。

确认后才进入阶段 2B-2。
