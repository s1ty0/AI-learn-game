# 开发技术栈与选型决策

日期：2026-11-07。状态：开发基线已落地为单人本地原型；Web/API/PostgreSQL首条闭环通过验证，未对外部署。当前实现与限制见[本地开发说明](./local-development.md)。

## 1. 结论

采用 **React + TypeScript + Next.js、React Flow、FastAPI、PostgreSQL**。

产品以桌面浏览器为首版主要交互入口，兼容窄屏知识阅读。知识站、可编辑地图、任务与实验共用内容和学习记录；Python复用现有数值和模型实验。桌面优先是本轮工程假设，移动端完整图编辑需另行验证。

## 2. 首版选定组件

| 部分 | 选择 | 在本项目中的职责 |
| --- | --- | --- |
| 前端语言 | TypeScript | 约束任务、图谱、接口与实验数据形状 |
| 页面与路由 | React + Next.js App Router | 知识页、专题导航、任务页、个人成果页 |
| 组件与样式 | Tailwind CSS + shadcn/ui | 表单、滑块、对话框、侧栏和一致的界面样式 |
| 图谱交互 | React Flow，包名 `@xyflow/react` | 自定义知识节点、连线、局部展开、拖动与视口 |
| 图布局 | 首版规则布局与保存位置；复杂自动布局再接elkjs | 保持学习者位置与认知稳定，按需展开局部图 |
| 实验可视化 | React + 原生SVG；较重本地计算放Web Worker | 注意力矩阵、掩码、梯度轨迹、参数变化与动画 |
| 前端数据同步 | TanStack Query + React状态 | 服务端数据缓存和提交状态；当前选择/拖动等局部状态由React管理 |
| 知识正文 | Markdown + react-markdown + 数学公式插件KaTeX | 复用现有中文文档，展示公式与模块链接 |
| 后端接口 | Python + FastAPI + Pydantic | 内容读取、学习事件、评价、推荐、图谱版本与模型适配 |
| 数据访问 | SQLAlchemy + psycopg；Alembic迁移 | 统一由Python管理数据库模型与结构变更 |
| 主数据库 | PostgreSQL | 节点/关系、学习证据、版本、快照和事务 |
| 资料维护 | 现有JSON、Markdown与Git | 内容源文件可审阅、可追溯，再导入版本化数据库 |
| AI辅导 | 后端模型适配器 | 追问、分层解释和辅助评价，保留来源、模型与提示版本 |
| 实验基准 | Python标准库 + 按需PyTorch | 核验浏览器数值、离线合成实验；不让Web请求直接执行训练脚本 |
| 检查 | pytest、Vitest、Playwright；保留现有unittest | 后端事务/规则、前端数值/状态、完整学习与图恢复流程 |
| 工程管理 | pnpm + uv；一个仓库 | 锁定JS/Python依赖，便于同时维护数据、界面与实验 |
| 运行方式 | 本地开发；后续Docker Compose | 首版Web/API/PostgreSQL三个服务，云供应商不绑定 |

Next.js区分服务端与客户端组件，适合将可阅读知识页与浏览器交互分开；React Flow支持可交互自定义节点与图状态序列化。它们并不自动提供学习评价、持久化或完整版本历史，这些由本项目实现。[Next.js组件边界](https://nextjs.org/docs/app/getting-started/server-and-client-components)、[React Flow自定义节点](https://reactflow.dev/learn/customization/custom-nodes)、[保存与恢复示例](https://reactflow.dev/examples/interaction/save-and-restore)

## 3. 为什么采用这组组合

### 知识站与游戏交互共存

React负责操作体验，Next.js承载知识页和应用路由。文档正文可以服务端读取并输出；地图、滑块和实验使用客户端组件。公开内容以后可提供稳定链接，个人学习区仍保留丰富交互。

本轮未用纯Vite单页应用作为主方案，原因是产品同时承担可查阅知识站与学习应用。若以后只发布纯静态离线版，需单独评估构建形态，不让主方案的服务端功能变成部署时才发现的依赖。

### Python承担学习业务和实验复用

已有知识校验、数值实验与PyTorch模型都在Python。FastAPI统一接管学习记录、评价和推荐，避免将同一套判分规则分别写进Node与Python。接口可由OpenAPI描述并生成前端类型。[FastAPI功能与OpenAPI](https://fastapi.tiangolo.com/features/)

Next.js不再另建一套权威学习后端，也不直接维护数据库表。它负责页面与统一访问入口，业务数据只从FastAPI进入。

### PostgreSQL承载首版动态图谱与历史

公共节点和关系分表存储，个人关系与证据另存，不能把整个世界塞进一个JSON字段。JSONB用于答案、配置和小型快照等有界结构；关系查询以ID、索引和有深度限制的遍历完成。[PostgreSQL JSONB](https://www.postgresql.org/docs/18/datatype-json.html)、[递归查询](https://www.postgresql.org/docs/18/queries-with.html)

首版不引入Neo4j。动态图谱指内容和个人理解随版本变化，不等于必须采用图数据库。若后续真实的多跳查询在索引、局部读取和缓存后仍不足，再通过同一查询样本评估图数据库，不能仅因节点数量增长就迁移。

## 4. 游戏层的具体边界

首版玩法是拖动、连线、改参数、预测、查错和观察结果。React、SVG与可控动画足以实现这一形态，暂不引入Unity、Unreal或Phaser。

简单数值实验在浏览器运行，数值基准由Python核对；计算较重时使用Web Worker，避免拖慢界面。PyTorch训练保持离线演示或显式任务边界，不能在HTTP请求中启动长训练。

若未来有必须重试和恢复的训练/采集作业，再增加独立作业进程与持久化队列。FastAPI的进程内后台任务不作为可靠训练队列。[FastAPI后台任务边界](https://fastapi.tiangolo.com/tutorial/background-tasks/)

## 5. 内容、检索与模型接入

- 内容保持Markdown与JSON，首次不改用可执行MDX。按已审阅的内容版本导入数据库，未审阅草稿在内部原型中明确标记。
- 首版搜索先做中文名称、英文名、别名精确/前缀匹配和正文基本检索；可用pg_trgm辅助相似匹配。中文分词、短查询和中英混合召回必须单独测，不能假定通用全文索引自动解决中文搜索。[pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html)
- 语义检索与pgvector按实际召回缺口再增加；目前不另建向量数据库。
- 模型调用放在FastAPI适配层，供应商、凭据与预算在接入时配置。本轮不绑定付费模型，也未选定模型SDK或接口协议。
- 能力状态由量规和证据规则更新；AI解释或辅助评价不能直接改写公共知识事实或无依据解锁。
- 独立题答案留在服务端评价数据中，公共知识/任务接口按白名单导出；当前仓库的分文件草稿不等于线上已隔离。

## 6. 版本与开发环境

已检查当前电脑：Node.js 24.19.0、Python 3.13.14；存在pnpm与uv命令。现有教学模型实测PyTorch 2.14.0+cpu。未在PATH发现Docker和psql，不能据此认定机器完全没有相关安装。

开发运行时基线选择Node.js 24与Python 3.13；PostgreSQL目标主版本为18，使用稳定补丁版本，不使用预发布版。Node发布状态与PostgreSQL文档已查官方来源。[Node.js发布信息](https://nodejs.org/en/about/previous-releases)、[PostgreSQL 18文档](https://www.postgresql.org/docs/18/)

框架与库已经实际安装，锁定于根目录 `pnpm-lock.yaml` 和 `apps/api/uv.lock`。当前核心版本：Next.js16.4.5、React19.3.1、React Flow12.12.1、TypeScript5.9.3、FastAPI0.162.0、SQLAlchemy2.1.8、Pydantic2.14.3、psycopg3.3.8、Alembic1.20.1。生产构建、数据库事务与浏览器检查已运行。

本地使用项目依赖下载的PostgreSQL18.6程序，由pg_ctl启动。embedded-postgres包装器锁定18.6.0-beta.19；包装器有预发布后缀，数据库内核为18.6。当前无Docker镜像或系统数据库服务。运行数据、随机密码与浏览器缓存留在忽略版本控制的.runtime目录。

与完整选型的差距：当前采用原生基础组件和自定义CSS，Tailwind构建链已安装，shadcn/ui尚未引入；实验轻量，不需要Web Worker；搜索为前端名称/别名子串匹配，未实现正文索引或pg_trgm；AI适配器、OpenAPI类型生成与完整身份隔离仍待实现。

## 7. 部署、账号与费用边界

先完成本地可运行的Web/API/PostgreSQL闭环。API与数据库部署位置保持可配置；未来可用单机Compose或分别托管，按实际用户规模与地区确定。当前未部署到任何服务。

本地原型先用明确的演示学习者档案。对外多用户试用前接入成熟OIDC身份服务或等价受维护方案，并由后端校验身份、隔离记录；供应商在部署阶段确定，不自行发明密码与会话协议。

首版没有GPU服务、独立搜索集群或复杂微服务。模型调用记录每轮次数、延迟与费用依据；具体额度由实际模型和试学规模决定，不预填成本承诺。

## 8. 替换和扩展条件

| 当前基线 | 何时再评估扩展 |
| --- | --- |
| PostgreSQL关系/版本存储 | 真实图遍历性能和维护成本出现可复现瓶颈 |
| React+SVG玩法 | 新玩法明确需要场景引擎的碰撞、精灵或实时场景能力 |
| 浏览器小实验与离线Python | 用户任务确实需要可恢复的服务端计算，补独立worker/队列 |
| 别名与基础检索 | 中文、中英混合与语义召回测试暴露稳定缺口 |
| 单人图谱修订 | 用户确认需要实时协作后再评估CRDT等机制 |

这不是未来扩展的禁令，而是避免首版同时承担尚未验证的系统复杂度。

相关文档：[系统边界](./architecture.md)、[数据模型](./data-model.md)、[开发计划](../PLAN.md)。
