# SciGuard 最小检查插件

工具名：`sciguard_check`、`sciguard_run_demo`，版本：0.2.1，许可证：MIT。

插件 JavaScript 无第三方 npm 依赖。sciguard_check 是只读检查工具，输入 Python 文本，返回 SG001 潜在泄漏风险、行号、证据和建议，不执行输入代码。sciguard_run_demo 是另一个固定实验工具，依赖 Python 和 requirements-demo.txt 中的组件，并经宿主审批执行固定模板。

## 安装

在当前 AGH 网页进入“设置 → 插件 → 从来源安装”，来源填写：

```text
file:./examples/packages/sciguard
```

检查包名 `@sciguard/scientific-check`、版本 0.2.1 和能力声明，再安装、启用。已安装旧版本的实例应先使用“从新来源更新”，填写同一来源，再启用。必须确认实际状态 ready 后，才在新任务中测试工具调用。

## 风险样例

在 AGH 新任务中发送：

```text
请实际调用 sciguard_check 检查下面的 Python 代码，报告规则编号、行号与修改建议。不要执行这段 Python 代码。

X_scaled = scaler.fit_transform(X)
X_train, X_test, y_train, y_test = train_test_split(X_scaled, y)
```

预期：`POTENTIAL_RISK`，规则 SG001，fit_line=1，split_line=2。必须展开工具记录核实调用，不能把模型自己生成的风险说明作为工具调用成功。

## 修正样例

```python
X_train, X_test, y_train, y_test = train_test_split(X, y)
X_train = scaler.fit_transform(X_train)
X_test = scaler.transform(X_test)
```

预期：`NO_PATTERN_FOUND`。该结果仅表示本规则没有发现模式，不表示代码或实验一定正确。

## 验证

从仓库根运行：

```powershell
node --test .\examples\packages\sciguard\check.test.mjs
```

## 范围

分析只覆盖 sklearn 风格的简单命名变量及直线代码模式，不是 Python AST 或完整数据流分析。忽略字符串和注释；支持部分模块限定文字形式，例如 pp.StandardScaler() 和 ms.train_test_split()，但不解析实际导入或所有别名关系，也不解析分支、循环、重赋值及跨函数数据流，可能误报或漏报。需人工核对风险证据。

插件已注册针对内置 `run_code` 的执行前 hook，但本机 AGH 尚未提供生产 Python runtime，标准会话也不展示 `run_code`。宿主模拟测试证明 hook 能拒绝调用；这不代表真实内置 Python 执行已可用。

## 固定真实实验入口

`sciguard_run_demo` 仅接受 `variant: risky | corrected`，不接受任意代码。内置 sklearn breast-cancer 分类脚本，每次在执行前复用检查器。修正版通过 AGH 的 `ToolContext.exec` 启动 Python，保留宿主审批、平台约束、60 秒超时和取消机制。risky 和 corrected 两种调用均声明 requiresApproval: always，由宿主处理审批；不能关闭审批来掩盖失败。

运行环境位于工作目录 `node_modules/.cache/sciguard-python`，依赖版本见 `requirements-demo.txt`。Windows 路径为其 `Scripts/python.exe`，其他平台为 `bin/python`。另一个工作目录需单独准备环境。

网页新任务的工作目录选择 AGH 仓库，然后发送：

```text
请实际调用 sciguard_run_demo，variant 为 risky。不要通过 shell 执行实验，也不要修改代码。
```

预期 `BLOCKED`、`executed: false`、SG001。之后发送：

```text
请实际调用 sciguard_run_demo，variant 为 corrected。不要改用 shell，也不要修改代码。
```

出现审批卡时核对本项目固定实验，选择“仅允许这次”。预期 `COMPLETED`、`executed: true` 及实际指标和版本。平台拒绝或审批失败时保留错误，不能宣称执行成功。

独立真实 Python 集成测试（不等于网页调用成功）：

```powershell
node --test .\examples\packages\sciguard\experiment.e2e.test.mjs
```

此入口不是 AGH 内置 Python runtime 的替代实现，没有任意代码沙箱承诺。不写项目文件，不下载数据，不访问网络，只通过固定脚本训练和评价模型。运行记录来自 AGH 工具记录，不提供独立科研审计认证。


提交副本说明：仅校正 README 的版本与依赖表述；index.mjs 和 experiment.mjs 与项目当前 0.2.1 源码逐字一致。
