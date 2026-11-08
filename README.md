# Glass Home

本地优先的 Liquid Glass 风格浏览器新标签页。**阶段 2B-1：Pointer 拖放与键盘布局操作已实现并通过自测**，等待用户检查；阶段 2B-2（整理与多断点）尚未授权。不是可发布版本。

## 本地开发

项目目录：`/Volumes/Cupcake/Workspace/glass-home`。要求：macOS / Node.js 22 或更新 / pnpm。

```bash
pnpm install
pnpm dev
pnpm build
```

生产扩展输出：`/Volumes/Cupcake/Workspace/glass-home/.output/chrome-mv3`。在 Edge 打开 `edge://extensions`，启用开发者模式，选择“加载解压缩的扩展”，加载上述目录。

当前已通过 TypeScript、86 项单元/属性测试、生产构建，以及 25 个真实 Edge 用例连续两轮共 50 次执行。阶段 2B-1 证据见 `docs/verification/stage-2b-1.md`；2A、1、0 的验证记录独立保留。

## 检查

```bash
pnpm check
pnpm build
pnpm test:e2e
```

`pnpm check` 依次运行类型检查、单元测试和生产构建。E2E 调用本机 Microsoft Edge 加载生产扩展，因此先执行 `pnpm build`。测试使用独立临时浏览器 profile，结束后清理；截图与报告保存在 `artifacts/`（已忽略 Git）。

默认 E2E 运行 `tests/e2e/stage-[12]*.spec.ts`，即阶段 1、2A、2B-1/2B 的用例。旧原型用例归档为 `stage-0.spec.ts.archived`，不纳入默认回归，避免继续断言已移除的设计面板。

## 当前能力

- 本地 MV3 新标签页，离线打开时钟、日期、月历、搜索和快捷图标。
- 搜索与直接网址导航；自定义搜索模板及危险协议本地拒绝。搜索只在你主动提交时访问所选服务，没有联网搜索建议。
- 20 个默认快捷图标，支持新增、编辑、复制、删除、文字/颜色回退；新增项在三个断点分别寻找合法空位。
- 时钟、搜索、日历和快捷图标共享 v1 整数网格数据模型；10/8/5 列独立布局。
- 编辑态目标格面板支持移动、交换、强制推挤、尺寸预设、锁定、预览、取消和撤销/重做。保存只影响目标断点；写入失败恢复旧布局。
- 指针拖放：普通模式与编辑模式均可拖动图标与 Widget。移动超过 6px 才算拖动，松手才提交；拖到图标本体为交换，拖到图标之间为插入推挤，拖到空白格为移动。拖动中显示源位轮廓与目标格反馈，`Esc` 或指针取消即回滚且不写入本地。
- 键盘布局：编辑模式下 `Tab` 选中对象后，方向键移动一格、`Alt+方向键` 调整尺寸；重排后焦点留在原对象。`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做，输入框内的撤销不受影响。
- 普通点击打开网址；指针移动超过 6px 时抑制误导航；锁定对象既不能拖动也不能键盘移动。
- 明暗主题、四档材质、减少动态效果、时间/时区/日历、搜索引擎和打开方式设置。
- Workspace v1 校验、IndexedDB 持久化、失败回滚、备份导入导出、本地壁纸与资源恢复。
- 空快捷方式、损坏工作区恢复、原始数据导出、存储失败提示。
- 最小权限 Manifest；sandbox 父 DOM 与扩展 API 隔离，严格 CSP。

## 尚未实现 / 未验收

- 阶段 2B-2：局部/全局智能整理、10/8/5 列独立布局编排、多页面 `expectedRevision` 冲突处理尚未实现（未授权）。
- Widget 指针拖拽尺寸手柄尚未实现；当前用 `Alt+方向键` 提供键盘尺寸调整。
- 拖动性能未做帧率测量；产品基线中的 60fps 目标与持续拖动长任务检测尚未验收。
- 布局撤销历史只保留在当前页面内存中；普通快捷方式 CRUD 不提供实体级撤销，成功提交会清理旧布局历史。
- 阶段 3：正式 Widget 平台、内置待办、第三方隔离开发模式；当前只有沙箱探针。
- 独立图片图标上传、跨页面同步、横向多页、Dock、文件夹、账号与云同步。
- Chrome、Windows、Firefox、Safari 未实测；目前只有 macOS Edge 实测，不宣称跨浏览器支持。
- 发布级键盘与屏幕阅读器、完整壁纸对比度、持续拖动性能尚未验收。
- 首次正式 Workspace 为 v1；阶段 0 只有探针，没有历史 Workspace 可迁移。后续从 v2 开始提供 schema 迁移。

## 文档

- 需求基线：`docs/product-baseline-v1.md`
- 实施计划：`docs/implementation-plan.md`
- 技术决策：`docs/adr/0001-stage-0-foundation.md`
- 网格状态机：`docs/grid-state-machine.md`
- 兼容矩阵：`docs/compatibility-matrix.md`
- 阶段验证：`docs/verification/`

项目只在本机开发，无账号、无行为统计、无远程脚本。未获用户明确授权不执行 Git 提交、推送或发布。
