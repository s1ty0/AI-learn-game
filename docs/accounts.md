# 账号与独立学习档案

本机游戏继续支持旧档案入口。注册账号后可以在自己的档案里续玩，保存星图、解释和历史。线上已开放注册，无需邀请码，个人数据仍需登录后访问。部署设置 `LEARN_OPEN_REGISTRATION=1` 控制开放注册；设为0或省略时，生产注册仍使用一次性邀请码。本机旧档案开关 `LEARN_LOCAL_DEMO` 与注册策略独立。

## 玩家操作

1. 在游戏或图谱手记右下角选择“登录 / 创建账号”。用户名为3至40位字母、数字、下划线或短横线，密码为12至128个字符。
2. 新账号从初始进度开始。“切换账号”重新加载对应档案，“退出登录”使本次会话失效。7天后需重新登录。
3. 图谱、进度和提交作答可跨设备访问。未提交草稿属于当前浏览器、标签页和账号。回到原标签页并登录同一账号时可以恢复，清理浏览器数据会移除本机草稿。

## 权限和数据归属

- 浏览器仅保存随机会话Cookie，数据库存会话摘要与有效期。密码使用独立随机盐与scrypt，参数为N=2¹⁷、r=8、p=1。线上Cookie启用Secure、HttpOnly和SameSite=Strict。密码存储参数参考[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)。
- 服务端按会话解析学习档案。图谱、探索、画像、领航、作答与复核读取沿用同一档案范围。另用页面绑定账号检查旧标签页请求，防止账号切换时把旧输入提交到新档案。
- 账号写请求要求同站点来源与自定义请求头。登录限速按进程维护，限制单个用户名、客户端及密码计算并发。线上部署需要在入口补充分布式或代理层限速，确认可信代理设置。
- 复核钥匙只访问指定学习档案。创建时可运行 `node scripts/reviewer-access.mjs create reviewer-id 显示名 --learner 用户名`。已有旧档钥匙保持原档案范围。可先停用不再使用的钥匙。
- 数据库迁移`0007`新增accounts、auth_sessions、auth_invites。旧作答的操作键改为按档案唯一。既有快照、事件和复核原文继续使用原有主键。

## 旧档案归属

迁移适用于同一个数据库中的本机旧档案。账号注册独立完成，维护者明确指定继承者。已开始学习的目标账号需要另行安排合并。

1. 用自己的新账号注册，先保留初始进度。
2. 停止Web/API，保留PostgreSQL。用PostgreSQL 18的`pg_dump`工具备份并验证可恢复。当前Windows环境可先设 `LEARN_PG_DUMP` 为匹配版本的可执行文件，再运行 `node scripts/backup-local-db.mjs`。备份进入忽略目录 `.runtime/db-backups/`。工具来源见[PostgreSQL Windows下载](https://www.postgresql.org/download/windows/)。
3. 运行 `node scripts/account-access.mjs claim-demo 用户名` 预检。确认目标与显示的旧图版本后执行 `node scripts/account-access.mjs claim-demo 用户名 --apply --server-stopped`。使用非默认API端口时设置 `LEARN_API_PORT` 为实际端口。
4. 重启并登录目标账号，核对历史与当前进度。原图ID和各历史记录继续保留，账号取得旧图归属，原空档案留下审计指向，目标账号的已有会话失效。匿名旧档入口随归属完成关闭。

`claim-demo`迁移数据库内已提交记录。旧浏览器未提交草稿应在迁移前保存到旧档案，或自行另存原文。

## 本机验证与运行

在端口冲突时，可设置 `LEARN_WEB_PORT=3100`、`LEARN_API_PORT=8100` 后运行 `pnpm dev`。测试可设置 `LEARN_LOCAL_DATABASE` 指向 `learnai_` 开头的隔离数据库。浏览器测试用 `LEARN_TEST_BASE_URL` 指向对应Web地址，真实账号浏览器流程只对确认过的隔离库设置 `LEARN_ACCOUNT_E2E=isolated-database`。

账号维护支持 `invite`、`reset-password 用户名` 和 `disable 用户名 --apply`。一次性邀请码保存在忽略目录，7天有效。密码重置从终端安全提示输入，停用及重置会撤销当前会话，学习历史保留。线上使用 `python -m app.account_access` 并从服务环境读取数据库配置。
