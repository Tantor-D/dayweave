# AI 协作与外部工具使用说明

## 文档的关键结论

`v0.3.0 / task-workbench` 的网页 AI 与外部 harness 操作同一份本地数据，并共用校验、审批、版本冲突和历史恢复。默认 AI 写入需要网页确认；自动接受只省略人工确认，仍保存历史。真实模型需用户配置，自动测试使用模拟 HTTP 接口，不代表真实供应商连接已验证。

- 数据本体是 `data/workspace.json`、`data/ai/*.md` 和 `data/reflections/**/*.md`；外部工具可以直接阅读，但规范修改应使用下述接口。
- 每轮安排前调用 `context`，读取最新长期背景、短期安排和任务版本；反思正文仅在明确选择后读取，不默认读取整个反思或历史目录。
- harness 连接已经启动的本机服务，不直接写文件，不允许自行更改审批策略或模型密钥。

## 网页 AI

1. 在“设置”填写 Chat Completions 兼容 API 基础地址、模型名和密钥。基础地址可填写 `https://供应商/v1` 或完整的 `/chat/completions` 地址；本地无密钥模型可以留空密钥。首版没有默认模型名，也不自动调用付费模型。
2. 在 AI 面板核对本次任务范围和反思选择。每次发送都会重新加载两类背景；看板筛选和 AI 范围分别管理。
3. 默认工具能力为自动检测。供应商明确拒绝工具参数时退回纯聊天，界面显示结构化变更已禁用。自然语言或 JSON 代码块不会被猜测执行。
4. 模型产生的结构化提案展示真实前后差异。在“必须网页确认”模式中确认后保存；自动接受模式直接提交合法且未过期的提案。
5. 一个目标对应一份提案，不同目标分别保存；依赖提案必须在前置项应用后才能应用。部分失败不会伪装为整个请求成功。

取消选择的反思原文不会在后续请求中再次附加；如果已有对话讨论涉及该反思，会提示新建对话。已发给供应商的内容无法撤回。会话只保存在当前服务内存中，重启后须新建对话；业务数据、历史与待确认提案独立持久化。

请求默认 60 秒超时，支持取消。每次请求总上下文超过本地字符预算会明确失败，不截断两类背景。密钥仅服务端使用，保存为数据目录之外的 `.local/secrets.json`，网页仅显示是否配置。

协议依据：[Chat Completions 函数调用](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[官方工具调用指南](https://developers.openai.com/api/docs/guides/function-calling)。模型必须支持此协议；仅支持 Responses 的模型不适用于首版结构化接口。

## 外部 AI 的每轮工作顺序

先在项目目录启动服务：

```sh
npm start
```

使用 `--silent` 避免 npm 的命令提示混入 JSON 标准输出：

```sh
npm run --silent harness -- context
npm run --silent harness -- read workspace
npm run --silent harness -- schema
```

`context` 无参数时读取当前未归档任务以及两类背景。指定范围时，通过 stdin 或 `--file` 传入：

```sh
npm run --silent harness -- context --file /tmp/focus-context.json
```

输入文件示例（任务 ID 按当前工作区填写）：

```json
{
  "startDate": "2026-11-03",
  "endDate": "2026-11-05",
  "taskIds": ["task-example"],
  "reflections": ["daily/2026-11-02"]
}
```

`taskIds` 显式提供时优先使用这一范围；不提供时按日期范围筛选有关排期。空数组代表明确不加载任务。反思引用可用 `daily/YYYY-MM-DD` 或 `notes/稳定ID`。

## 创建提案、提交与重试

1. `read workspace` 返回当前 `revision` 和 `hash`。把读取值原样写入 `baseRevision` 与 `baseHash`，不要自行计算或猜测。
2. 创建操作负载，例如：

```json
{
  "target": "workspace",
  "baseRevision": 0,
  "baseHash": "用读取结果中的64位哈希替换",
  "summary": "新增今天的专注事项",
  "operations": [
    { "type": "task.create", "id": "focus-example", "title": "完成第一份草稿", "parentId": null, "tagIds": ["P1"] },
    { "type": "placement.put", "taskId": "focus-example", "placement": { "id": "placement-example", "kind": "day", "date": "2026-11-03" } }
  ]
}
```

标签 ID 必须使用当前 `tags` 返回的 ID；上面的 `P1` 仅用于说明，旧数据迁移后的 ID 可能不同。`schema` 返回完整操作结构，不接受任意路径、脚本、设置修改或未知字段。

```sh
npm run --silent harness -- preview --file /tmp/focus-proposal.json
npm run --silent harness -- submit 返回的提案ID --request-id 本次唯一请求ID
```

`preview` 返回持久化提案 ID 和真实前后内容。`submit` 返回 `pending_confirmation` 时，在网页打开提案并确认；`applied` 代表保存完成，可追踪 `changeId`。冲突时重新读取并生成新提案。网络超时后使用**同一提案与同一 requestId**重试，不重复创建；提案已应用后重试会返回已有结果。

操作名包括：`tag.create/update/remove`、`task.create/update`、`placement.put/remove`、`text.write`。归档使用 update 中的 `archivedAt`，恢复设为 `null`；完成任务使用 `status: "done"`。任务使用 `parentId` 保存父任务 ID，根任务为 `null`，用 `tagIds` 保存多个标签 ID；标签名称禁止包含 "/"。父任务完成会完成后代；全部子任务完成会向上完成祖先；重新打开子任务会重新打开祖先。联动可能影响当前选择范围外的同树任务，提案须明确影响。拖动已有排期时沿用其 ID；一个任务可有多个定时安排，允许重叠。

## 任务状态、颜色与标签传播

任务状态只接受 `todo`（未完成）和 `done`（已完成）。旧快照中的 `in_progress` 在迁移及恢复时转换为 `todo`。

标签可配置 `color`（如 `#537fc5`）与 `colorPriority`（0–9999，越小越优先）。多标签同优先级时按标签顺序及 ID 稳定取色；归档标签不参与颜色选择。

新建任务或修改 parentId 时，服务端按当前复制继承设置合并父标签。修改子任务标签不会改变父任务。更新父任务标签默认仅影响自身；只有用户明确同意同步后代时，才在 task.update 上设置 `propagateTags: true`：

```json
{
  "type": "task.update",
  "id": "parent-task",
  "patch": { "tagIds": ["tag-current"] },
  "propagateTags": true
}
```

此操作向全部后代合并父任务当前标签，并从后代移除本次在父任务删除的标签；保留后代其余标签。提案说明须明确新增／移除标签与后代影响，不将父任务名称的变化解释为标签传播授权。

## 背景、反思与历史

```sh
npm run --silent harness -- read long-term
npm run --silent harness -- read short-term
npm run --silent harness -- read daily/2026-11-03
npm run --silent harness -- history workspace
```

修改 Markdown 时使用读取到的哈希；新建文档用 `baseHash: null`：

```json
{
  "target": "daily/2026-11-03",
  "baseHash": null,
  "summary": "记录当日反思",
  "operations": [{ "type": "text.write", "content": "今天完成了草稿。明天先校对关键假设。\n" }]
}
```

独立反思的标题写在正文中，例如 `# 一周复盘`。文档路径由服务端从逻辑引用映射，不接受任意磁盘路径。

从历史恢复时先读取目标当前哈希，再准备：

```json
{ "changeId": "目标历史编号", "side": "before", "baseHash": "目标当前64位哈希" }
```

```sh
npm run --silent harness -- restore --file /tmp/focus-restore.json
npm run --silent harness -- submit 返回的恢复提案ID --request-id 本次唯一请求ID
```

`before` 恢复修改前，`after` 恢复修改后。工作数据恢复影响整个工作区快照；Markdown 恢复只影响所选文档。恢复是新的提交，保留旧历史且工作区 revision 继续递增。

## 本机路径、连接与边界

默认地址为 `http://127.0.0.1:4310`，凭据读取 `.local/harness-token`。自定义运行目录或端口时：

```sh
npm run --silent harness -- read --url http://127.0.0.1:4311 --local-dir /绝对路径/本机设置
```

也可设置 `WORKBENCH_URL` 和 `WORKBENCH_LOCAL_DIR`。harness 仅连接回环地址，不把工具凭据发到远程服务。错误以 JSON 输出且退出码非零；未运行时明确提示启动。浏览器令牌和 harness 令牌分开，外部工具不能通过 `source` 参数冒充网页手工操作。

拥有本机同一用户文件权限的 AI 物理上仍能编辑文件，这不是权限隔离沙箱。绕过规范入口的修改会暂停该目标标准写入，由网页展示差异后显式采纳或恢复；未被采纳的版本不冒称为已审批。原始文件的多次外部直改中间状态不保证被逐个捕获；完整逐次历史覆盖规范入口以及显式采纳的最终外部版本。

标签管理按拖拽顺序保存 `colorPriority`（越靠上越优先）。`tag.remove` 删除标签并清理所有任务中的对应引用，不删除任务；需要保留关联时使用归档。
