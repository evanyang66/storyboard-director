# 分镜调度台 / Storyboard Director

用俯视场景安排角色走位、动作和摄像机路径，并用 2D / 3D 视图预演镜头的本地工具。

## 开始使用

双击 `index.html` 或 `启动.bat`，使用 Edge / Chrome 打开。手动分镜功能无需安装、无需联网。

- 俯视调度、角色动作、朝向与摄像机轨迹。
- 2D / 3D 镜头预演与时间轴编辑。
- 导出项目 JSON、俯视图、镜头图及 WebM 预演视频。

## 可选 AI 编排

安装 Node.js 18+，复制 `ai-config.example.json` 为 `ai-config.json`，填写自己的本地 ComfyUI 或兼容 API 设置，再运行 `启动AI.bat`。AI 功能为可选增强，不影响手动使用。API 密钥只填在自己电脑上，`ai-config.json` 已被 Git 忽略。

完整操作与更新说明见 [使用说明](docs/完整使用说明.md)。

## 项目文件

- `index.html`：浏览器入口。
- `css/`、`js/`：界面、调度、渲染、导出与 AI 编排源码。
- `ai-proxy.js`：本机 AI 代理，使用 Node.js 内置模块。
- `downloads/storyboard-director.zip`：可直接解压使用的源码包。

个人主页：[EvanYang AI](https://evanyang.kdns.fr/tools)
