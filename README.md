# Glass Home

本地优先的 Liquid Glass 风格浏览器新标签页扩展（Chrome MV3）。数据只留在本机：无账号、无行为统计、无远程脚本。

## 环境要求

- Node.js 22 或更新
- pnpm

## 快速开始

```bash
pnpm install
pnpm build          # 生产构建 → .output/chrome-mv3
```

加载扩展：打开 `edge://extensions`（或 `chrome://extensions`）→ 开启「开发者模式」→「加载解压缩的扩展」→ 选择 `.output/chrome-mv3` → 新开标签页即进入 Glass Home。

```bash
pnpm dev            # 开发模式（热更新）；不会自动打开浏览器
pnpm zip            # 打包可分发的 zip
```

> **只加载 `.output/chrome-mv3`**。`pnpm dev` 另行生成 `.output/chrome-mv3-dev`，那份内含连接 `ws://localhost:3000` 的热更新客户端：开发服务器没在跑时，扩展错误页会报 `WebSocket connection to 'ws://localhost:3000/' failed` 与 `[wxt] Failed to connect to dev server`。要用开发版就先运行 `pnpm dev` 并保持该进程，用完从浏览器移除。

## 测试

```bash
pnpm check                      # 类型检查 + 单元/属性测试 + 生产构建
pnpm build && pnpm test:e2e     # 真实 Microsoft Edge 加载生产扩展
```

- **E2E 全程无窗口（headless）**：不打开可见浏览器，不抢焦点与键盘，运行期间可以照常使用电脑。
- 每条用例使用系统临时目录里的独立浏览器 profile；trace 与失败截图也写到系统临时目录。仓库内 `artifacts/` 只保留 `e2e-results.json` 这类单文件报告。

## 能力概览

- 离线可用的新标签页：时钟、日期、月历、搜索。首次安装附 20 个预设快捷方式，之后只通过「+」添加自己的。
- 统一整数网格：10/8/5 列独立布局，指针拖放（移动 / 交换 / 插入推挤）、键盘移动与缩放、撤销重做；紧凑整理一键完成，立即保存且可一步撤销。
- 时钟 / 搜索 / 日历 / 待办四种小组件，可像 iOS 一样在编辑模式里增删（移除会一并清除该组件的数据）；Widget 宿主把单个组件的崩溃隔离在它自己的格子里，另有只读沙箱通道。
- 明暗主题、四档材质、减少动态效果、时间与时区、搜索引擎与打开方式设置。
- Workspace v2 校验 + IndexedDB 持久化、备份导入导出、本地壁纸与资源恢复。
- 快捷方式显示站点真实图标（读浏览器已缓存的图标，无网络请求）；只有 `favicon` 一个权限，无 `host_permissions`，严格 CSP。

## 权限与隐私

扩展申请的权限、数据存放位置与网络行为见 [`docs/privacy-and-permissions.md`](docs/privacy-and-permissions.md)。

## 适用范围

个人自用阶段的构建，不是发布版本：只实测过 Microsoft Edge，Chrome / Firefox / Safari 未验证；发布级无障碍与性能指标未验收。
