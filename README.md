# QuantLife Web

QuantLife Web is a local-first progress tracker with optional LLM-assisted planning and activity parsing.

The project is designed so each user brings their own API key. No API key or personal progress data should be committed to GitHub.

## What Is Included

- `fengdingding-progress.html` - the web UI
- `server.js` - local Express server, SQLite persistence, and LLM proxy endpoints
- `icons/` - PWA icon assets used by the HTML
- `progress.example.json` - clean starter progress data
- `llm-config.example.json` and `.env.example` - configuration templates without secrets

## Quick Start

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3030
```

On first launch, the app can start from the built-in clean template. If you want to seed the server with example data, copy `progress.example.json` to `fengdingding-progress.json` before starting.

## Configure Your Own API

Option 1: Use the in-app LLM settings panel. The app saves your key locally to `llm-config.json`, which is ignored by Git.

Option 2: Use environment variables:

```bash
cp .env.example .env
npm run dev
```

Edit `.env` and set your own provider, base URL, model, and API key.

OpenAI-compatible providers use:

- `LLM_PROVIDER=openai`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

Anthropic-compatible providers use:

- `LLM_PROVIDER=anthropic`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_MODEL`

## 个性化设置

打开应用内的设置中心，可以自定义：

- 昵称
- 应用名称
- 主页标语
- 头像文字或头像图片 URL
- 启用的维度、维度名称、排序、目标和经验系数

这些设置会保存在用户自己的本地进度数据中，不会写回共享模板。

## Files That Must Stay Private

These files are intentionally ignored:

- `.env`
- `llm-config.json`
- `fengdingding-progress.json`
- `fengdingding-progress.db*`
- `backups/`

Before publishing, run a secret scan and make sure those files are not staged.
