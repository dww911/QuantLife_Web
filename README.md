# QuantLife Web

QuantLife Web 是一个本地优先的人生成长记录工具。你可以用它记录每日打卡、经验值、维度成长、任务营地、财富目标，也可以接入自己的 AI API 来做文字解析和规划。

这个项目不会自带任何人的 API Key。每个用户都需要配置自己的 API。

## 适合谁

- 想把生活、学习、运动、创作做成“升级系统”的人
- 想在自己电脑本地运行，不想把私人数据交给第三方平台的人
- 想自己接 OpenAI 兼容接口、Anthropic 兼容接口，或其他兼容大模型服务的人

## 0 基础本地部署教程

### 第 1 步：下载项目

打开项目地址：

```text
https://github.com/dww911/QuantLife_Web
```

如果你不会用 Git，最简单的方法是：

1. 点击 GitHub 页面右上方绿色按钮 `Code`
2. 点击 `Download ZIP`
3. 下载完成后解压
4. 进入解压后的 `QuantLife_Web-main` 文件夹

如果你会用 Git，也可以运行：

```bash
git clone https://github.com/dww911/QuantLife_Web.git
cd QuantLife_Web
```

### 第 2 步：安装 Node.js

这个项目需要 Node.js。

1. 打开 Node.js 官网：

```text
https://nodejs.org/
```

2. 下载并安装 LTS 版本
3. 安装完成后，打开终端检查：

Windows 可以打开 PowerShell，macOS 可以打开“终端”，然后输入：

```bash
node -v
npm -v
```

如果能看到版本号，就说明安装成功。

### 第 3 步：打开项目文件夹里的终端

Windows：

1. 打开解压后的项目文件夹
2. 在文件夹空白处按住 `Shift`，点击鼠标右键
3. 选择“在终端中打开”或“在 PowerShell 中打开”

macOS：

1. 打开“终端”
2. 输入 `cd `，后面拖入项目文件夹
3. 回车

示例：

```bash
cd 你的项目文件夹路径
```

### 第 4 步：安装依赖

在项目文件夹的终端里输入：

```bash
npm install
```

第一次安装会稍微等一会儿。看到没有报错，就可以继续。

### 第 5 步：启动本地服务

继续输入：

```bash
npm run dev
```

如果看到类似下面的内容，说明启动成功：

```text
Progress server running at http://localhost:3030
```

### 第 6 步：打开网页

打开浏览器，访问：

```text
http://localhost:3030
```

你应该能看到 QuantLife 页面。

以后每次使用时，只需要：

1. 打开项目文件夹终端
2. 输入 `npm run dev`
3. 浏览器打开 `http://localhost:3030`

## 第一次使用建议

打开页面后，先进入“设置中心”：

- 修改昵称
- 修改应用名称
- 修改主页标语
- 设置头像文字、头像图片 URL，或选择本地头像图片
- 修改成长维度名称、目标、排序和经验系数
- 配置自己的 AI API

默认资料是中文通用模板，用户可以随时改成自己的版本。

## 配置自己的 AI API

如果你只想手动记录打卡，可以先不配置 API。

如果你想使用 AI 文字解析、AI 规划功能，需要配置自己的 API。

### 方法一：在网页里配置

1. 打开 `http://localhost:3030`
2. 进入“设置中心”
3. 找到“AI 连接设置”
4. 填入：
   - Provider
   - Base URL
   - Model / Endpoint
   - API Key / Token
5. 点击“保存 AI 配置”
6. 点击“测试连接”

配置会保存到本地的 `llm-config.json`，这个文件不会上传到 GitHub。

### 方法二：使用 `.env`

复制 `.env.example` 为 `.env`，然后编辑 `.env`。

OpenAI 兼容接口示例：

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com
LLM_API_KEY=填你自己的key
LLM_MODEL=gpt-4.1-mini
```

Anthropic 兼容接口示例：

```env
LLM_PROVIDER=anthropic
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_AUTH_TOKEN=填你自己的token
ANTHROPIC_MODEL=claude-sonnet-4-5
```

改完后重新启动：

```bash
npm run dev
```

## 数据保存在哪里

本项目是本地优先。

主要本地数据文件：

- `fengdingding-progress.json`
- `fengdingding-progress.db`
- `fengdingding-progress.db-shm`
- `fengdingding-progress.db-wal`
- `backups/`
- `llm-config.json`

这些文件都已经被 `.gitignore` 忽略，不会被提交到 GitHub。

如果你想备份自己的数据，可以备份：

```text
fengdingding-progress.json
fengdingding-progress.db*
backups/
llm-config.json
```

注意：`llm-config.json` 里可能有你的 API Key，不要发给别人。

## 常见问题

### 1. npm install 报错怎么办？

先确认 Node.js 是否安装成功：

```bash
node -v
npm -v
```

如果没有版本号，请重新安装 Node.js LTS。

### 2. 打不开 http://localhost:3030 怎么办？

确认终端里已经运行：

```bash
npm run dev
```

并且这个终端不要关闭。

如果提示端口被占用，可以换一个端口：

Windows PowerShell：

```powershell
$env:PORT=3031; npm run dev
```

macOS / Linux：

```bash
PORT=3031 npm run dev
```

然后打开：

```text
http://localhost:3031
```

### 3. AI 功能不能用怎么办？

先确认：

- API Key 是自己的
- Base URL 没写错
- Model / Endpoint 没写错
- 服务商账号有余额或权限
- 在设置中心点击过“保存 AI 配置”

如果仍然失败，先看“测试连接”的错误提示。

### 4. 本地头像图片能用吗？

可以。进入“设置中心”，选择“本地头像图片”。系统会自动压缩并保存到你的本地进度数据中。

### 5. 可以直接双击 HTML 打开吗？

不推荐。直接双击 HTML 只能使用部分本地功能，云端同步、AI 接口、SQLite 保存都需要通过本地服务运行。

推荐始终使用：

```bash
npm run dev
```

然后打开：

```text
http://localhost:3030
```

## 文件说明

- `fengdingding-progress.html`：前端页面
- `server.js`：本地后端服务
- `icons/`：图标资源
- `progress.example.json`：干净的初始数据示例
- `.env.example`：环境变量示例
- `llm-config.example.json`：AI 配置示例
- `.gitignore`：忽略本地私有数据和密钥

## 开源安全提醒

不要上传这些文件：

- `.env`
- `llm-config.json`
- `fengdingding-progress.json`
- `fengdingding-progress.db*`
- `backups/`

它们包含用户自己的配置、进度数据，甚至可能包含 API Key。
