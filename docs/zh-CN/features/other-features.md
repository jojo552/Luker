# 其他功能

本页列出 Luker 中其他用户可见的独有功能。这些功能虽然规模较小，但在日常使用中能显著提升体验。

## 世界书激活链路追踪

Luker 会记录世界书条目从匹配到注入的完整链路，帮助你调试复杂的世界书配置。详见[世界书激活链路追踪](/zh-CN/features/world-info-trace)。

## 角色卡绑定人设

Luker 允许角色卡携带推荐人设，并随角色卡一起导出。打开角色卡时，若尚未选择人设，Luker 会自动切换到推荐人设；若当前人设与卡上推荐的人设不一致，会由你决定是否切换。详见[角色卡绑定预设与人设](/zh-CN/improvements/card-bound-presets)。

## 聊天工具面板

聊天工具面板（Current Chat Tools Panel）是一个非阻塞式的工具面板，在聊天界面中提供快速访问当前聊天相关工具的入口。面板不会遮挡聊天内容，你可以在对话过程中随时使用工具功能。

## 弹窗更新器

弹窗更新器（Popup Updater）提供应用内的更新流程。当有新版本可用时，会以弹窗形式引导你完成更新操作。更新器具备 Docker 环境感知能力，会根据你的部署方式（Docker 或本地安装）提供对应的更新指引。

## 图像生成增强

Luker 对图像生成的增强是 ComfyUI WebSocket 连接支持——使用 WebSocket 与 ComfyUI 通信，替代频繁的 HTTP 轮询端点，提升生成效率和实时性，支持智能回退和断线重连重试。

## 插件注册正则

插件可以动态注册正则表达式规则到正则处理系统中。详见[插件注册正则](/zh-CN/features/regex-provider)。

## 引导配置导入

引导配置导入（Onboarding Config Import）优化了首次使用的引导流程。在初始设置阶段，你可以直接导入已有的配置文件，包括：

- 完整的应用设置
- 扩展配置

这对于从其他实例迁移或在新设备上快速恢复工作环境特别有用，避免了从零开始配置的繁琐过程。

## 相关功能

- [用户设置新增功能](/zh-CN/features/user-settings-additions) — 用户设置里 Luker 独有的控制项，外加备份、迁移与存储工具
- [搜索插件](/zh-CN/features/search-tools) — AI 联网搜索能力
- [角色卡编辑助手](/zh-CN/features/card-editor/) — 增强的角色卡编辑体验
- [记忆图](/zh-CN/features/memory-graph) — 基于知识图谱的记忆系统
