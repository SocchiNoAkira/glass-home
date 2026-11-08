# 网格状态机与事务边界（草案）

## 状态

```text
idle
  | pointer down / keyboard start
  v
intent-pending --< 6～8px --> dragging
  | click                         | target cell changed
  v                               v
activate-item              solving-preview (revision + operationId)
                                  | valid                 | invalid
                                  v                       v
                             preview-ready            preview-blocked
                                  | drop / Enter
                                  v
                             validating-commit
                                  | valid                 | timeout/cancel/stale
                                  v                       v
                             persisting ------------------> idle (no mutation)
                                  | ok                 | failure
                                  v                    v
                             committed ----------> rolled-back
                                  |                    |
                                  v                    v
                            one undo entry           idle
```

## 必须成立

- `dragging` 和 `preview-ready` 都不写持久化；移动的是候选副本。
- `solving-preview` 带有 `operationId + baseRevision + target signature`。目标格未变不重复求解，旧 operation 的结果必须丢弃。
- 提交前对整个候选执行不变量检查，而非只检查拖动项。
- 只有持久化完成才进入 `committed`；存储失败显示失败并回滚，不能显示“已保存”。
- Esc 在拖动中先取消当前事务，在编辑态中再退出编辑模式。
- 撤销/重做按整个事务恢复，包括链式推挤和全局整理。

## 布局操作选择

1. 目标完全空闲：move。
2. 同尺寸对象：swap 快路径。
3. 不同尺寸：双方可合法互换原区域才 swap，否则 push。
4. push 超预算或锁定冲突：局部 reflow；找不到合法结果返回原布局。
5. 全局整理：独立命令，必须预览影响数量与高度，确认后提交；普通拖动绝不升级为全局整理。

## 并发

- 每个 Workspace 有 revision，每个布局提交带 expectedRevision。
- 非编辑页接收新 revision；编辑页维护操作草稿，不被后台更新强制清空。
- 提交遇到 revision 冲突，读取最新 Workspace 并重放原 command；不能安全重放则提示用户并保留草稿。
- Service Worker 可被休眠，不作为唯一事实来源；以持久化数据和 revision 为准。
