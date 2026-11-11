# Vercel 公网部署

本项目采用 Vercel Services 将 Next.js 前端与 FastAPI 后端部署为同一个地址，数据库使用 Vercel Marketplace 的 Neon PostgreSQL 免费套餐。Services 当前为 Beta。此方案不使用原阿里云主机，也不修改 NetBird 的域名、端口或服务。

## 部署结构

- 仓库根目录的 `vercel.json` 定义两个服务。`/api/v1/*` 直接转到 FastAPI，其余请求转到 Next.js。浏览器始终使用同源 API。
- Web 使用 Node.js 24 与锁定的 pnpm 依赖。API 使用 Python 3.13 与 `uv.lock`。
- API 构建时执行 `apps/api/build.py`，只打包公共课程目录。课程包不包含本机数据库、账号、草稿或密钥。数据库迁移独立执行，不在每次构建中自动修改数据库。
- Web/API 与 Neon 数据库优先使用新加坡区域。免费套餐的配额和休眠行为以平台实际显示为准。

## 首次发布

1. 登录 Vercel CLI，在自己的团队创建并显式关联本项目。修改任何远端设置前，运行 `vercel project inspect --non-interactive` 核对项目和团队。
2. 从 Marketplace 创建 Neon，明确选择免费套餐，只连接 Production。首次安装由账号持有人在浏览器确认条款。
3. 设置 `LEARN_LOCAL_DEMO=0`。数据库连接由 Neon 注入，禁止加 `NEXT_PUBLIC_` 前缀。可用 `LEARN_WEB_ORIGIN` 指定网站来源；未指定时，生产环境使用平台提供的生产域名，预览环境使用本次部署域名。
4. 将 Production 环境变量拉取到 Git 忽略目录，只核对变量名称。使用非池化连接运行 `python -m alembic upgrade head`，先核对目标确实是新建的部署数据库。原本机玩家存档不自动迁入云端。
5. 固定源码提交，从干净的发布目录执行 `vercel deploy --prod`。检查构建日志及实际分配的公网地址。不要把构建中或受平台登录保护的地址当作可游玩的交付。
6. 创建一次性邀请码，在真实 HTTPS 地址验证注册、退出、登录、探索、星图保存、刷新续玩和跨账号隔离，再交付网址与私有邀请码文件。

## 保存与冷启动

运行时兼容 Neon 的标准 PostgreSQL URL，使用项目已有的 psycopg 驱动，并保留 TLS 参数。云端每个实例限制本机连接池；冷启动用数据库事务级咨询锁串行化内容初始化，避免不同实例同时创建同一内容版本与初始图谱。

账号密码计算、幂等、版本校验和行锁规则沿用原实现。当前登录限速是进程内计数，多实例之间不共享；对外扩大试学前应接入共享限速或平台防火墙。邀请码注册继续保留，不能把当前部署说成已完成大规模公开运营验收。

## 更新与回滚

更新前核对项目、源码提交和迁移版本。先备份数据库，再决定是否迁移；应用回滚不会自动回退数据库。预览部署使用独立数据库分支，不能直接连接生产库做测试写入。S2 的备份恢复、故障通知和应用回滚验收仍按[邀请内测发布准备](./invite-beta-deployment.md)执行，全部通过后再创建内测 tag。

参考：[Vercel Services](https://vercel.com/docs/services)、[FastAPI 部署](https://vercel.com/docs/frameworks/backend/fastapi)、[Neon 集成](https://vercel.com/marketplace/neon)。
