# 算法知识数据集结构 v0.1.0

日期：2026-11-07。状态：目录数据版本0.1.4，目录结构0.1.0；中文内容0.2.1、结构0.2.0；专题任务结构0.1.0。已有摘要、深入草稿和Transformer贯穿专题，教学数据集尚不完整。

## 1. 文件与唯一数据源

| 文件 | 管什么 |
| --- | --- |
| `data/catalog/domains.json` | 领域目录 |
| `data/catalog/entities.json` | 算法、损失、架构、基础概念等实体 |
| `data/catalog/sources.json` | 实际访问过的来源与核查范围 |
| `data/catalog/relations.json` | 带命题、条件与来源的关系提案 |
| `data/catalog/backlog.json` | 缺漏、审校、来源与玩法维护任务 |
| `data/schemas/catalog.schema.json` | 机器可检查的字段与状态约束 |
| `docs/catalog-coverage.md` | 从当前数据生成的覆盖与缺口报告 |
| `data/content/zh-CN/index.json` | 中文显示名、首次出现解释、知识卡及来源关联 |
| `data/schemas/chinese-content.schema.json` | 中文草稿索引结构，不允许冒充已审核内容 |
| `knowledge/zh-CN/` | 中文知识卡正文与可直接打开的入口 |
| `knowledge/zh-CN/deep/` | 八项检查面的深入草稿，不能代替独立审核 |
| `docs/depth-coverage.md` | 从中文索引生成的深入内容与缺口报告 |
| `examples/learning_lab.py` | 标准库数值参考实验，不是完整模型或游戏 |
| `examples/tiny_transformer.py` | 一层因果教学模型，包含前向、损失、更新与生成 |
| `data/topics/transformer.json` | 专题、模块、来源、图解与实验关联 |
| `data/quests/transformer.json` | 8个练习草案，包含提示与图谱修订阶段 |
| `data/assessments/transformer-challenges.json` | 3个独立挑战题与量规草案，未接入判分 |
| `data/schemas/transformer-topic.schema.json` | 专题、练习与量规的结构约束 |

JSON 是登记后持续编辑的正式目录数据；介绍文档用于解释。初始化脚本只运行一次，发现目录已存在即拒绝覆盖，避免以后从旧文档重新生成而丢失人工补充。

## 2. 身份与状态

ID 采用 `domain-001`、`entity-0001`、`source-001`、`relation-0001`、`issue-001` 等不含名称的稳定编号；后续追加新编号，改名不改 ID，不复用归档编号。别名不是独立实体，跨领域时追加领域关联。

公共实体、个人图节点、学习目标不是同一个对象。目前已实现公共目录及中文草稿索引；个人记录、课程版本快照、正式任务与评价结构仍待设计。

实体内容状态与游戏状态分开。`source_registered` 仅表示存在候选来源，不是内容正确性的背书。所有首批实体都未通过教学内容审核，所有关系均为提案，不能用于正式判分或解锁。

`hard_prerequisite` 为真时必须是已审核的 `prerequisite` 关系。方向约定：先修实体为 `from_id`，依赖它的实体为 `to_id`。当前尚未批准任何硬性先修；无循环检查通过不等于先修设计完成。

## 3. 关联与证据

实体关联来源时记录用途、具体位置和关联审核状态。关系单独记录可读命题、成立条件与来源，不从实体同属一个领域自动生成知识关系。

关系来源只是候选依据；摘要级资料不足以验证所有模块细节。审核后必须补审校角色与日期。目录允许暂缺来源，但报告应公开缺口，正式发布讲解前必须补齐。

源资料使用范围与技术事实审核分开记录。当前没有复制全文，`reuse_status` 均为 `not_assessed`。

中文知识卡沿用稳定实体 ID，不因显示名改成英文或中文而重复建点。每个独立入口按[语言规则](./language-policy.md)说明首次出现的术语。内容结构0.2.0在每张摘要上增加深入路径、深入来源、`layered_draft`状态和明确缺口；词表和正文仍为草稿，不据此升级审核状态。初始批次与深入批次使用一次性脚本追加，持续维护以现有JSON为准。

站点对标来源仅用于观察教学与产品组织，在 `checked_scope` 中标记用途；无法访问的来源记为 `unavailable`，不得成为已经核查的技术依据。

## 4. 校验方法

在项目根目录运行以下命令。PowerShell 的 `Test-Json` 做 JSON Schema 校验，Python 标准库脚本做跨文件引用、重复身份、审核证据与硬性先修循环检查。

```powershell
Get-ChildItem -LiteralPath data/catalog -Filter '*.json' -File | ForEach-Object {
    if (-not (Test-Json -LiteralPath $_.FullName -SchemaFile data/schemas/catalog.schema.json -ErrorAction Stop)) {
        throw "Schema validation failed: $($_.Name)"
    }
}
python scripts/check_catalog.py --write-report
Test-Json -LiteralPath data/content/zh-CN/index.json -SchemaFile data/schemas/chinese-content.schema.json
python scripts/check_chinese_content.py --write-index
python examples/learning_lab.py
python examples/tiny_transformer.py
python scripts/check_transformer_topic.py
@('data/topics/transformer.json','data/quests/transformer.json','data/assessments/transformer-challenges.json') | ForEach-Object {
    if (-not (Test-Json -LiteralPath $_ -SchemaFile data/schemas/transformer-topic.schema.json -ErrorAction Stop)) {
        throw "Topic schema failed: $_"
    }
}
python -m unittest discover -s tests
```

Schema 不负责判断算法理论对错。跨文件脚本不替代 Schema；两者都通过也不能把未审校内容升级为可发布教材。

标准库实验不需第三方计算框架；教学模型及其检查需要PyTorch，实测2.14.0+cpu。独立挑战与练习已分文件，但尚无检索/权限系统，不能声称已实现答案隔离。来源的2.15文档参考与本地2.14运行结果分别记录，不以跨版本未测试的功能作结论。

## 5. 下一批数据

1. 为已有候选实体补英文名、别名和可靠出处，处理重复与交叉标签。
2. 优先核查损失、梯度下降、L2 和 Transformer 代表档案的具体命题与正文。
3. 补适合初学者的中文讲解，并记录来源和可复用范围。
4. 审阅新增8份深入草稿，补[深度报告](./depth-coverage.md)列出的完整实现、真实数据和现代变体缺口，不以章节齐全作为完成标准。
5. 再补任务、提示、独立评价、学习证据与版本快照，不把尚未存在的字段视为已经实现的功能。
