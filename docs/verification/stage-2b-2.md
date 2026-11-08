# 阶段 2B-2 验证记录：局部重排与紧凑整理

日期：2026-11-09
环境：macOS，Microsoft Edge 157.0.4341.42；Chrome / Windows / Firefox / Safari 未实测
起始基线：`cd69238`（阶段 2B-1 视觉修复收尾）
结论：**实现完成并通过自测，等待用户检查确认**

## 1. 范围修订（重要）

按用户 2026-11-09 确认，采用方案 A：**全局整理只做"紧凑排列"**，"保持分组"模式不做；**局部重排接入拖动失败路径**。

审计后确认原计划 `implementation-plan.md` 行 95–100 的四条中有两条**无对象可做**：

| 计划条目 | 审计结论 | 处置 |
|---|---|---|
| 10/8/5 列独立布局、恢复优先 | **已存在**。`layouts` 本身就是 `Record<GridColumns, LayoutItem[]>`，三档独立存储/编辑/恢复，2A 已断言 8/5 列不受影响 | 不重复实现，改用例 17/18 覆盖 |
| 多页面 `expectedRevision` 冲突 | 当前为单页面布局，`revision` 单一，没有第二个页面对比 | 不实现，如实记录 |

## 2. 本轮改动

**solver（`src/domain/grid/solver.ts`）**
- 新增命令 `{ type: 'compact' }` 与 `LayoutOperation` 值 `'reflow' | 'compact'`。
- `compact()`：锁定对象固定在原位；其余按面积降序、再按阅读顺序逐个落进首个空位。不改变任何尺寸，结果必过全量校验。
- `reflow()`：仅在推挤搜索返回空且失败原因不是 `budget-exceeded`/`cancelled` 时触发。拖动对象钉在目标位、锁定对象钉住，其余按阅读顺序贪心放置，尺寸不变。

**界面（`LayoutInspector.tsx` / `stage-2a.css`）**
- 新增"紧凑整理"按钮，独立成行（它是整页动作，不属于选中对象）。
- 预览显示"影响 N 个对象"与"页面高度 X → Y 行（增/减/不变）"，满足基线 6.11 的预览要求。

**测试**
- `layout-compact.test.ts`（15 项）：紧凑整理与局部重排的行为。
- `compact-properties.test.ts`（1 项属性测试，80 次随机）：不变量、不改尺寸、锁定不动、页面不变高、确定性。
- `compact-transaction.test.ts`（6 项）：事务门禁、撤销/重做、拒绝改尺寸与移动锁定对象。
- `layout-acceptance-14-2.test.ts`（23 项，21 通过 + 2 明确跳过）：**逐条映射 14.2 的 20 项**。
- `stage-2b2-compact.spec.ts`（4 项）：真实 Edge 行为。

## 3. 修复/纠正的问题

**(a) 紧凑整理的界面文案误导。** 初版写"只压缩空白"，实测在默认 10 列布局上它改动了 **20/23 个对象**（唯一空洞在 y=2 的 x=6..9，4 个图标填入后整行按阅读顺序前移）。这不是 bug——按基线 6.11 的"向上向左压缩、保持相对顺序"就该如此——但文案会让人以为是微调。已改为明确提示"会重排多数对象，请先看预览的影响数量"。

**(b) 我自己写的两处恒真断言已删除。** 初版在 14.2 用例 #14/#16 里用 `expect(typeof document === 'undefined').toBe(true)` 冒充覆盖，实际什么都没验证。已改为 `it.skip` 并在名字里写明由哪个 Edge 用例真正覆盖。当前该文件如实报告 **21 passed | 2 skipped**。

**(c) 撤销了一次多余的拖动重试。** 我一度在 `useGridDrag` 里给预览失败加"以 push-first 重试"。核实 solver 控制流后确认：`preference` 只影响空位与单对象交换两个快速路径，两者失败后都会落到同一个推挤搜索，其失败路径才是 reflow。该重试只会重复同一次失败并清掉已有错误说明，已移除。

## 4. 实际执行命令与结果

```
pnpm run typecheck   → exit 0
pnpm run test        → 16 files / 127 passed | 2 skipped (129)
pnpm run build       → 474.00 kB
pnpm run check       → 三阶段全绿
pnpm exec playwright test --repeat-each=2 → 58 passed (4.2m)
```

E2E：29 个用例 × 2 轮 = 58 次，全部通过。阶段 1、2A、2B-1 的既有 25 个用例（×2=50）保持通过。

## 5. 14.2 的 20 项对照

| # | 用例 | 覆盖位置 | 状态 |
|---|---|---|---|
| 1 | 空位移动只改目标对象 | acceptance #1 | 通过 |
| 2 | 图标插入两图标之间产生链式推挤 | acceptance #2 | 通过 |
| 3 | 当前行满时链尾进入下一行 | acceptance #3 | 通过 |
| 4 | 页末无空位时增加行 | acceptance #4 | 通过 |
| 5 | 同尺寸图标/组件正确交换 | acceptance #5 | 通过 |
| 6 | 不同尺寸仅在合法时直接交换 | acceptance #6（正反两例） | 通过 |
| 7 | 无法直接交换时进入推挤或局部重排 | acceptance #7 | 通过 |
| 8 | 大组件放入密集区无重叠 | acceptance #8（逐对碰撞检查） | 通过 |
| 9 | 推挤链循环检测与其他路径/回滚 | acceptance #9 | 通过 |
| 10 | 锁定对象不被自动操作移动 | acceptance #10 + `stage-2b2` 锁定用例 | 通过 |
| 11 | 保持实例 ID、配置与用户数据 | acceptance #11 | 通过 |
| 12 | 不自动缩小对象 | acceptance #12 + 属性测试 | 通过 |
| 13 | 撤销恢复整条链、重做恢复结果 | acceptance #13 + `compact-transaction` | 通过 |
| 14 | `Esc` 取消所有预览位移 | `stage-2b-layout.spec.ts`（拖动中按 Esc） | 通过（浏览器层） |
| 15 | 快速连续拖动不被旧结果覆盖 | acceptance #15 + `stage-2b-layout` 连续拖动用例 | 通过 |
| 16 | 求解超时或存储失败完整回滚 | acceptance #16 前半 + `stage-2a-layout` 写失败用例 | 通过 |
| 17 | 10→8→5 列后无重叠 | acceptance #17 | 通过 |
| 18 | 恢复原断点后恢复用户布局 | acceptance #18 | 通过 |
| 19 | 全局整理确认前不修改持久化 | acceptance #19 + `stage-2b2` 预览不落盘用例 | 通过 |
| 20 | 随机布局对象数不无故减少、无重复 | acceptance #20 + 属性测试 | 通过 |

## 6. 证据

- `artifacts/e2e-results.json`：两轮完整回归报告。
- `/tmp/glass-home-shots/stage-2b2-compact-preview-edge.png`：整理预览（含影响数量与高度变化）。
- `/tmp/glass-home-shots/stage-2b2-compact-committed-edge.png`：整理提交后（页面由 10 行压至 5 行）。
- `/tmp/glass-home-shots/stage-2b-drag-*.png`：2B-1 拖动反馈。

截图统一写入本地 `GLASS_HOME_SHOTS`（默认 `/tmp/glass-home-shots`），不写项目目录，`captureViewport` 会打印落点。

## 7. 明确未完成 / 未验收

- **"保持分组"整理模式未实现**。当前默认布局无 `groupId`，实现后恒为空操作，属无对象功能。如后续加入分组能力需重新规划。
- **多页面 `expectedRevision` 冲突未实现**，因为当前是单页面布局。
- **Widget 指针拖拽尺寸手柄**仍未实现（2B-1 遗留），尺寸调整仅 `Alt+方向键`。
- 拖动/整理的**帧率未测量**，基线 60fps 与持续拖动长任务检测未验收。
- 完整屏幕阅读器流程、Chrome/Windows/Firefox/Safari 均未实测。
- 局部重排在极端密集布局下可能因预算耗尽而回滚，此时提示语沿用既有预算文案。

## 8. 暂停确认

请在 Edge 加载 `.output/chrome-mv3` 后检查：

1. **紧凑整理**：编辑模式下把某个图标拖到页面很下方，再点"紧凑整理"——应看到预览列出影响对象数与高度变化，此时刷新前数据未变；点"取消"完全还原，点"确认并保存"后页面压紧且可一次撤销。
2. **锁定保护**：锁定日历后执行紧凑整理，日历必须停在原格不动。
3. **局部重排**：把日历组件拖到密集的图标区，若推挤找不到位置应仍能落位（标记为"局部重排"），而不是报错回滚。
4. **键盘与拖动**：2B-1 的行为保持不变。

确认后才进入阶段 3（Widget 平台）。
