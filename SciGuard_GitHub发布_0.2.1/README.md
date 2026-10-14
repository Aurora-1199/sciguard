# SciGuard 0.2.1

基于 Agnes Harness（AGH）的科研代码预处理泄漏检查与受控固定实验演示。

SG001 用启发式文本规则检查“对全量数据 fit/fit_transform，随后 train_test_split”的潜在泄漏，报告行号、证据和修正建议。Agnes 模型通过 AGH 组织任务、调用插件并解释反馈，确定性风险判定来自检查器。

## 快速复现：只需 Node

克隆或下载本仓库后，在仓库根执行（开发环境 Node 24.21.0；完整 AGH 要求 Node >=24.10）：

```powershell
node --test .\examples\packages\sciguard\check.test.mjs
node .\examples\packages\sciguard\benchmark\run-benchmark.mjs
node .\examples\packages\sciguard\benchmark\challenge\run-challenge.mjs
node .\examples\packages\sciguard\benchmark\challenge-v2\run-challenge-v2.mjs
```

这部分无需安装 npm 依赖、无需 Python、无需模型 Key，不执行检查输入中的 Python。评测输出位于 outputs；已有报告在 verification/reports。

## AGH 集成

- sciguard_check：只读文本检查。
- tool_call hook：仅针对 run_code；拒绝匹配风险及定义的不可分析输入，不拦 shell。
- sciguard_run_demo：仅 risky/corrected 两种固定模板，内部检查后通过 ToolContext.exec 启动项目 Python，保留 AGH 审批。它与 run_code hook 是两条控制路径。

完整安装、固定 Python 环境、模型账户和导出记录步骤见 [复现说明](docs/复现说明.md)。该仓库不是完整 AGH，也不是公共在线服务；完整演示要将插件与可选宿主测试放入独立 AGH checkout，基准提交为 38232a955b876a20065e8f54d29fd61021b4c859。

## 已有验证与局限

| 验证 | 结果与适用范围 |
|---|---|
| 检查器单测 | 16/16；包含直接 hook 与模拟执行端，不等于全部真实 Python |
| 基础文本集 | 20/20；不执行案例 Python |
| 原挑战集 | 原标签 TP3/FN1/FP0/TN6；召回 75%；标签和片段需结合复核说明，CH-07 跨函数漏报保留 |
| v2 | 二分类子集 7 条 TP3/FN0/FP0/TN4；另 3 条 needs_review 排除，不能外推通用 100% |
| AGH 固定实验历史记录 | risky BLOCKED/false，corrected COMPLETED/true；原生 trace 单独提供给赛事评审，不在公开仓库发布 |

历史修正版使用 UCI Wisconsin Diagnostic 数据集，seed=42、train/test=455/114、accuracy=0.9824561403508771、混淆矩阵 [[41,1],[1,71]]，环境 Python 3.12.14 / scikit-learn 1.7.2。该指标用于固定流程演示，不是临床效果证据。

检查器不是 Python AST 或完整数据流分析，不解析所有导入、分支、循环、重赋值、别名与跨函数关系。未发现模式不代表无泄漏或实验正确。固定实验也不是任意代码安全沙箱。全新机器安装未实测。

## 文档与归属

- [作品说明](docs/作品说明.md)
- [正常、边界、失败三类样例](docs/测试样例_正常边界失败.md)
- [模型与第三方来源](docs/模型与第三方使用清单.md)
- [视频后期辅助模型来源](docs/视频后期与来源说明.md)
- verification：实际文本评测结果、历史宿主报告与挑战集复核说明。

SciGuard 插件代码为 MIT。上游 Agnes Harness 为 Apache-2.0，保留 AGH-LICENSE 与 AGH-NOTICE；宿主测试文件中上游示例遵循原许可。Python 和数据依赖遵循各自许可。原始数据来源 UCI，DOI:10.24432/C5DW2B，CC BY 4.0，引用见模型与来源清单。不把第三方成果归为本队原创。

公开视频及其他公开项目内容尚待发布，发布后可在此 README 添加真实链接。此初稿不包含假链接、账号 Key、个人成员声明或原生会话记录。

2026-10-14 已在独立发布副本核对检查器单测 16/16、基础文本集 20/20，补充三类文本／直接模拟 hook 样例 8/8；未重跑 Python 科研实验。
