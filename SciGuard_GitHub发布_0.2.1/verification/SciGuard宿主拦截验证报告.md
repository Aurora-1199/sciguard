# SciGuard 宿主拦截验证报告

## 历史报告定位

这是 2026-10-12 的宿主模拟执行验证报告，本次文本修订未重跑该测试。下文“下一阶段”是当时的计划；后续已加入固定 `sciguard_run_demo`，其真实 Python 结果见原生 trace。固定演示工具不等于内置 run_code 的真实 Python runtime，不改变下文模拟执行边界。

## 历史正文

验证日期：2026-10-12。

## 结果

通过真实 AGH Host 的插件加载、会话、工具调度和工具结果记录流程，验证 SciGuard 的 `tool_call` hook 能拒绝目标工具调用，且拒绝后模拟执行器没有被调用。

| 场景 | 模拟 execute 次数 | 实际验证 |
| --- | ---: | --- |
| 数据划分前拟合预处理 | 0 | 返回 SciGuard 拒绝及 SG001 证据 |
| 先划分、仅在训练集拟合 | 1 | 返回 RUN_CODE_MOCK_EXECUTED |
| 空代码 | 0 | 返回非空输入要求 |
| 超长代码 | 0 | 返回检查失败原因 |
| 未闭合字符串 | 0 | 返回分析不完整原因 |
| 非目标工具 | 1 | 正常执行模拟工具 |

## 实现与验证命令

扩展现有测试文件：`packages/host/test/assemble/plugin-extension-hook-examples.test.ts`。

```powershell
pnpm exec vitest run packages/host/test/assemble/plugin-extension-hook-examples.test.ts --maxWorkers=1
```

结果：该文件 8 个测试通过，其中 6 个为新增 SciGuard 场景，2 个为原有示例场景。

## 测试边界

- SciGuard 从实际示例包加载为普通插件行，未直接调用 hook 函数来替代宿主调度。
- `run_code` 是内置保留名称，因此模拟实现由测试专用的内置 code-mode 工厂提供，未放宽第三方插件注册限制。
- 测试使用 `hybrid` 工具展示配置，避免标准配置隐藏 `run_code` 导致 TOOL_NOT_DISCLOSED，进而误判为 SciGuard 拦截。
- 使用模拟执行器，不运行 Python，不训练模型，不产生实验副作用。
- 该结果证明宿主拦截链路有效，不证明真实 Python 运行环境可用、代码已执行或科研结论正确。
- 当前 SG001 分析仍为启发式规则，可能误报、漏报；放行不等于实验安全认证。

## 下一阶段

实现并验证明确的科研执行入口，再将检查、执行、拒绝原因及实验结果关联到同一任务记录。实际入口需要独立验证执行权限、超时、取消和进程清理；不能把测试用模拟工厂当作生产 Python runtime。
