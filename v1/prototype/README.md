# 老己完整 UI 原型

本目录是老己 MVP 的响应式高保真 UI 定稿。它按真实产品页面拆分，不提供独立总览或审查快捷入口。

> 实现状态：PPT 范围、大纲、模板、逐页生成和书籍作品列表已接入共享生命周期；桌面四阶段页沿用同一会话、累计消息和可折叠连续工作台。开发与评审仍以 `../docs/prd/laoji-mvp-prototype-prd.md` 和 `../docs/ui/laoji-mvp-ui-design-spec.md` 为准。

## 入口

- 认证入口：`laoji-login.html`
- 登录后入口：`laoji-chat.html`
- 共享视觉与交互：`assets/laoji.css`、`assets/laoji.js`、`assets/laoji-state.js`
- 视觉绑定：`brand-spec.md`

## 页面映射

### 认证

- `laoji-login.html`：登录
- `laoji-register.html`：注册
- `laoji-reset-password.html`：找回密码、链接失效、设置新密码与完成状态

### 核心产品

- `laoji-chat.html`：多会话对话、带封面的对话选书与同页 PPT 范围工作区
- `laoji-library.html`：封面-only 统一书架、搜索、导入与连接微信读书
- `laoji-wechat-book.html`：我的笔记、书友笔记、老己笔记与读书 PPT
- `laoji-epub-reader.html`、`laoji-pdf-reader.html`：共用同一套本地书详情、笔记和 PPT 界面，仅阅读内容分别采用连续章节与分页渲染

### PPT

- `laoji-ppt-materials.html`：从书籍入口进入时复用的 PPT 范围确认工作区
- `laoji-ppt-outline.html`：同一会话内嵌的大纲作品画布
- `laoji-ppt-preview.html`：同一会话内嵌的预览、生成恢复与导出画布

桌面“对话 / 读书 / 设置”共享 64px 全局导航轨，可统一展开至 188px并跨页面恢复；会话列表是“对话”的 240px 二级上下文栏，宽屏可固定、中等桌面使用临时抽屉。PPT 四阶段沿用相同壳层，平板与手机保持单任务作品层，所有阶段链接都携带同一 `conversation` 参数。

老己笔记没有独立页面；每本书只在自身详情的“老己笔记”内容区中管理笔记。

### 设置

- `laoji-settings.html`：设置聚合首页，展示个人资料摘要、服务状态与账户安全
- `laoji-profile-settings.html`：独立个人资料详情页，点击头像即可更换头像，并显式保存昵称
- `laoji-account-email.html`：账户与安全下的独立登录邮箱详情页，承载当前邮箱与两步验证修改流程
- `laoji-ai-setup.html`：AI 服务配置、验证、失效与撤销
- `laoji-weread-setup.html`：微信读书 Skill Key 保存、测试、同步与凭证清除

产品行为以 `../docs/prd/laoji-mvp-prototype-prd.md` 为准，视觉方向与体验底线以 `../docs/ui/laoji-mvp-ui-design-spec.md` 为准。
