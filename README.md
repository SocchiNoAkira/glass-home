# Glass Home

本地优先的 Liquid Glass 风格浏览器新标签页。**阶段 2A：布局内核与事务已实现并通过既定 Edge 验收**，等待用户检查；自由拖放的阶段 2B 尚未开始。不是可发布版本。

## 本地开发

项目目录：`/Volumes/Cupcake/Workspace/glass-home`。要求：macOS / Node.js 22 或更新 / pnpm。

```bash
pnpm install
pnpm dev
pnpm build
```

生产扩展输出：`/Volumes/Cupcake/Workspace/glass-home/.output/chrome-mv3`。在 Edge 打开 `edge://extensions`，启用开发者模式，选择“加载解压缩的扩展”，加载上述目录。

当前已通过 TypeScript、52 项单元/属性测试、生产构建和连续两轮共 36 次真实 Edge 用例执行。阶段 2A 证据见 `docs/verification/stage-2a.md`；阶段 1、0 的验证记录独立保留。

## 检查

```bash
pnpm check
pnpm build
pnpm test:e2e
```

`pnpm check` 依次运行类型检查、单元测试和生产构建。E2E 调用本机 Microsoft Edge 加载生产扩展，因此先执行 `pnpm build`。测试使用独立临时浏览器 profile，结束后清理；截图与报告保存在 `artifacts/`（已忽略 Git）。

默认 E2E 运行 `tests/e2e/stage-1*.spec.ts` 和 `tests/e2e/stage-2a-layout.spec.ts`。旧原型用例归档为 `stage-0.spec.ts.archived`，不纳入默认回归，避免继续断言已移除的设计面板。

## 当前能力

- 本地 MV3 新标签页，离线打开时钟、日期、月历、搜索和快捷图标。
- 搜索与直接网址导航；自定义搜索模板及危险协议本地拒绝。搜索只在你主动提交时访问所选服务，没有联网搜索建议。
- 20 个默认快捷图标，支持新增、编辑、复制、删除、文字/颜色回退；新增项在三个断点分别寻找合法空位。
- 时钟、搜索、日历和快捷图标共享 v1 整数网格数据模型；10/8/5 列独立布局。
- 编辑态目标格面板支持移动、交换、强制推挤、尺寸预设、锁定、预览、取消和撤销/重做。保存只影响目标断点；写入失败恢复旧布局。
- 普通点击打开网址；指针移动超过 6px 时抑制误导航，不触发布局改变。
- 明暗主题、四档材质、减少动态效果、时间/时区/日历、搜索引擎和打开方式设置。
- Workspace v1 校验、IndexedDB 持久化、失败回滚、备份导入导出、本地壁纸与资源恢复。
- 空快捷方式、损坏工作区恢复、原始数据导出、存储失败提示。
- 最小权限 Manifest；sandbox 父 DOM 与扩展 API 隔离，严格 CSP。

## 尚未实现 / 未验收

- 阶段 2B：Pointer Events 自由拖放、尺寸手柄、局部/全局整理、键盘布局操作、多页面 `expectedRevision` 冲突处理尚未实现。
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
