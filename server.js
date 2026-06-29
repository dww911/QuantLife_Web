require('dotenv').config();
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3030);
const ROOT = __dirname;
const PROGRESS_JSON = path.join(ROOT, 'fengdingding-progress.json');
const HTML_FILE = path.join(ROOT, 'fengdingding-progress.html');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_FILE = path.join(ROOT, 'fengdingding-progress.db');
const LLM_CONFIG_FILE = path.join(ROOT, 'llm-config.json');

// OpenAI-compatible LLM config (set via environment variables)
// - LLM_BASE_URL: e.g. https://api.openai.com (or compatible provider base)
// - LLM_API_KEY: token
// - LLM_MODEL: model name, e.g. gpt-4.1-mini (provider-specific)
// - LLM_PROVIDER: openai | anthropic (default: openai)
const LLM_PROVIDER = String(process.env.LLM_PROVIDER || 'openai').trim().toLowerCase();
const LLM_BASE_URL = String(process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
const LLM_API_KEY = String(process.env.LLM_API_KEY || '');
const LLM_MODEL = String(process.env.LLM_MODEL || '');

// Anthropic-compatible config
// - ANTHROPIC_BASE_URL: e.g. https://api.anthropic.com (or compatible provider base)
// - ANTHROPIC_AUTH_TOKEN: token
// - ANTHROPIC_MODEL: model / endpoint id
const ANTHROPIC_BASE_URL = String(process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
const ANTHROPIC_AUTH_TOKEN = String(process.env.ANTHROPIC_AUTH_TOKEN || '');
const ANTHROPIC_MODEL = String(process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '');
let runtimeLlmConfig = null;

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS progress_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_at TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_saved_at ON progress_snapshots(saved_at DESC);
`);

const selectLatestStmt = db.prepare(`
  SELECT payload, saved_at
  FROM progress_snapshots
  ORDER BY id DESC
  LIMIT 1
`);
const insertSnapshotStmt = db.prepare(`
  INSERT INTO progress_snapshots(saved_at, source, payload)
  VALUES (@saved_at, @source, @payload)
`);

async function writeJsonBackupAndCurrent(payloadObj) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `progress-${stamp}.json`);
  const text = JSON.stringify(payloadObj, null, 2);
  await fs.writeFile(PROGRESS_JSON, text, 'utf-8');
  await fs.writeFile(backupPath, text, 'utf-8');
}

async function seedDbFromJsonIfNeeded() {
  const latest = selectLatestStmt.get();
  if (latest) return;
  try {
    const raw = await fs.readFile(PROGRESS_JSON, 'utf-8');
    const parsed = JSON.parse(raw);
    insertSnapshotStmt.run({
      saved_at: new Date().toISOString(),
      source: 'json_seed',
      payload: JSON.stringify(parsed)
    });
  } catch {
    // If file doesn't exist or parse fails, start with empty db state.
  }
}

function buildDefaultLlmConfig() {
  return {
    provider: LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai',
    openai: {
      base_url: LLM_BASE_URL,
      api_key: LLM_API_KEY,
      model: LLM_MODEL
    },
    anthropic: {
      base_url: ANTHROPIC_BASE_URL,
      auth_token: ANTHROPIC_AUTH_TOKEN,
      model: ANTHROPIC_MODEL
    }
  };
}

function normalizeLlmConfig(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const provider = String(src.provider || base.provider || 'openai').trim().toLowerCase();
  const next = {
    provider: provider === 'anthropic' ? 'anthropic' : 'openai',
    openai: {
      base_url: String(src?.openai?.base_url ?? base?.openai?.base_url ?? '').trim().replace(/\/+$/, ''),
      api_key: String(src?.openai?.api_key ?? base?.openai?.api_key ?? '').trim(),
      model: String(src?.openai?.model ?? base?.openai?.model ?? '').trim()
    },
    anthropic: {
      base_url: String(src?.anthropic?.base_url ?? base?.anthropic?.base_url ?? '').trim().replace(/\/+$/, ''),
      auth_token: String(src?.anthropic?.auth_token ?? base?.anthropic?.auth_token ?? '').trim(),
      model: String(src?.anthropic?.model ?? base?.anthropic?.model ?? '').trim()
    }
  };
  return next;
}

async function ensureRuntimeLlmConfigLoaded() {
  if (runtimeLlmConfig) return runtimeLlmConfig;
  const defaults = buildDefaultLlmConfig();
  try {
    const raw = await fs.readFile(LLM_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    runtimeLlmConfig = normalizeLlmConfig(parsed, defaults);
  } catch {
    runtimeLlmConfig = defaults;
  }
  return runtimeLlmConfig;
}

async function saveRuntimeLlmConfig(next) {
  runtimeLlmConfig = next;
  await fs.writeFile(LLM_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
}

function maskSecret(secret) {
  const s = String(secret || '');
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function toPublicLlmConfig(cfg) {
  return {
    provider: cfg.provider,
    openai: {
      base_url: cfg.openai.base_url,
      model: cfg.openai.model,
      api_key_masked: maskSecret(cfg.openai.api_key)
    },
    anthropic: {
      base_url: cfg.anthropic.base_url,
      model: cfg.anthropic.model,
      auth_token_masked: maskSecret(cfg.anthropic.auth_token)
    }
  };
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function safeJsonParse(text) {
  const s = String(text || '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      return JSON.parse(s.slice(i, j + 1));
    }
    throw new Error('LLM 输出不是合法 JSON');
  }
}

function countEncodingAnomalyStrings(node) {
  let count = 0;
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur === 'string') {
      if (/[�]|\?{3,}/.test(cur)) count += 1;
      continue;
    }
    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
      continue;
    }
    if (typeof cur === 'object') {
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  }
  return count;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

function getLatestProgressOrThrow() {
  const latest = selectLatestStmt.get();
  if (!latest) throw new Error('未找到进度数据，请先提交一次保存。');
  return JSON.parse(latest.payload);
}

function recomputeLevels(progress) {
  const total = Number(progress.total_exp) || 0;
  progress.total_exp = total;
  progress.level = Math.floor(total / 200) + 1;
  progress.current_level_exp = total % 200;
  progress.exp_to_next = 200 - progress.current_level_exp;
}

function ensureDailyLog(progress, dateStr) {
  if (!progress.daily_log || typeof progress.daily_log !== 'object') progress.daily_log = {};
  if (!progress.daily_log[dateStr]) {
    progress.daily_log[dateStr] = { date: dateStr, entries: [], day_total_exp: 0, dimensions_touched: [] };
  }
  const log = progress.daily_log[dateStr];
  if (!Array.isArray(log.entries)) log.entries = [];
  if (!Number.isFinite(Number(log.day_total_exp))) log.day_total_exp = 0;
  if (!Array.isArray(log.dimensions_touched)) log.dimensions_touched = [];
  return log;
}

function ensureDimensions(progress) {
  if (!progress.dimensions || typeof progress.dimensions !== 'object') progress.dimensions = {};
  // Ensure existing keys are sane
  Object.keys(progress.dimensions).forEach(k => {
    if (!progress.dimensions[k] || typeof progress.dimensions[k] !== 'object') progress.dimensions[k] = { total_exp: 0 };
    if (!Number.isFinite(Number(progress.dimensions[k].total_exp))) progress.dimensions[k].total_exp = 0;
  });
}

function normalizeDimensionKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return '';
  if (!/^[a-z0-9_]+$/.test(k)) return '';
  return k;
}

function ensureDimensionDefs(progress) {
  if (!progress.meta || typeof progress.meta !== 'object') progress.meta = {};
  if (!progress.meta.dimensions || typeof progress.meta.dimensions !== 'object') {
    progress.meta.dimensions = { schemaVersion: 1, defs: {} };
  }
  if (!progress.meta.dimensions.defs || typeof progress.meta.dimensions.defs !== 'object') {
    progress.meta.dimensions.defs = {};
  }
  // Seed built-ins if missing (backward compatibility)
  const defaults = {
    research: { key: 'research', name: 'Learning', emoji: 'L', goal: 'Define your learning goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 60 } },
    tem: { key: 'tem', name: 'Special Skill', emoji: 'T', goal: 'Define a specialized skill goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 60 } },
    coding: { key: 'coding', name: 'Coding', emoji: 'C', goal: 'Define your coding goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 70 } },
    media: { key: 'media', name: 'Creation', emoji: 'M', goal: 'Define your creation goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 55 } },
    editing: { key: 'editing', name: 'Editing', emoji: 'E', goal: 'Define your editing or craft goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 45 } },
    speech: { key: 'speech', name: 'Communication', emoji: 'S', goal: 'Define your communication goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 50 } },
    fitness: { key: 'fitness', name: 'Fitness', emoji: 'F', goal: 'Define your fitness goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 40 } },
    makeup: { key: 'makeup', name: 'Style', emoji: 'I', goal: 'Define your style or self-care goal.', color: '', archived: false, exp_config: { mode: 'base_rate', base_rate_per_hour: 30 } }
  };
  Object.keys(defaults).forEach(k => {
    if (!progress.meta.dimensions.defs[k]) progress.meta.dimensions.defs[k] = defaults[k];
  });

  // Normalize defs keys
  const next = {};
  Object.keys(progress.meta.dimensions.defs).forEach(rawKey => {
    const key = normalizeDimensionKey(rawKey);
    if (!key) return;
    const d = progress.meta.dimensions.defs[rawKey];
    if (!d || typeof d !== 'object') return;
    next[key] = {
      key,
      name: String(d.name || key),
      emoji: String(d.emoji || ''),
      goal: String(d.goal || defaults[key]?.goal || ''),
      color: String(d.color || ''),
      archived: Boolean(d.archived),
      exp_config: d.exp_config && typeof d.exp_config === 'object' ? d.exp_config : { mode: 'base_rate', base_rate_per_hour: 50 }
    };
  });
  progress.meta.dimensions.defs = next;
}

function getValidDimensionKeySet(progress) {
  ensureDimensionDefs(progress);
  const defs = progress.meta.dimensions.defs || {};
  return new Set(Object.keys(defs).filter(k => defs[k] && !defs[k].archived));
}

function getEnabledDimensionKeySet(progress, reqBody) {
  const valid = getValidDimensionKeySet(progress);

  const fromBody = Array.isArray(reqBody?.enabled_dimension_keys) ? reqBody.enabled_dimension_keys : null;
  if (fromBody) {
    const cleaned = fromBody.map(x => String(x || '').trim()).filter(k => valid.has(k));
    if (cleaned.length > 0) return new Set(cleaned);
  }

  const enabledByKey = progress?.meta?.ui?.dimensionConfig?.enabledByKey;
  const order = progress?.meta?.ui?.dimensionConfig?.order;
  if (enabledByKey && typeof enabledByKey === 'object') {
    const keys = Array.isArray(order) ? order : Array.from(valid);
    const enabled = keys.filter(k => valid.has(k) && enabledByKey[k] !== false);
    if (enabled.length > 0) return new Set(enabled);
  }

  return valid;
}

const DIFF_MULT = { easy: 0.8, normal: 1.0, hard: 1.25 };

function getBaseRateByDim(progress) {
  ensureDimensionDefs(progress);
  const defs = progress.meta.dimensions.defs || {};
  const map = {};
  Object.keys(defs).forEach(k => {
    const d = defs[k];
    const cfg = d?.exp_config || {};
    if (cfg.mode === 'base_rate' && Number.isFinite(Number(cfg.base_rate_per_hour))) {
      map[k] = Number(cfg.base_rate_per_hour);
    } else if (cfg.mode === 'coeff' && Number.isFinite(Number(cfg.coeff))) {
      // Coeff mode fallback: approximate base-rate from old UI rule (50 exp/hour)
      map[k] = Math.max(1, Math.round(50 * Number(cfg.coeff)));
    } else {
      map[k] = 50;
    }
  });
  return map;
}

function getDimLabel(progress, key) {
  ensureDimensionDefs(progress);
  const d = progress.meta.dimensions.defs?.[key];
  return d?.name || key;
}

function calcExp({ dimension_key, minutes, difficulty, effective }, baseRateByDim) {
  const mins = clampInt(minutes, 0, 360);
  const base = baseRateByDim?.[dimension_key] ?? 50;
  const mult = DIFF_MULT[difficulty] ?? 1.0;
  const eff = effective ? 1.0 : 0.0;
  return Math.max(0, Math.round((mins / 60) * base * mult * eff));
}

function validateAndNormalizeParsed(parsed, validKeys) {
  if (!parsed || typeof parsed !== 'object') throw new Error('LLM 输出格式错误：不是对象');
  const activities = Array.isArray(parsed.activities) ? parsed.activities : null;
  if (!activities) throw new Error('LLM 输出格式错误：缺少 activities 数组');

  const normalized = activities
    .filter(a => a && typeof a === 'object')
    .map(a => {
      const dimension_key = String(a.dimension_key || '').trim();
      const minutes = clampInt(a.minutes, 0, 360);
      const difficulty = String(a.difficulty || 'normal').trim();
      const summary = String(a.summary || '').trim();
      const effective = Boolean(a.effective);
      if (!validKeys?.has(dimension_key)) return null;
      if (!['easy', 'normal', 'hard'].includes(difficulty)) return null;
      if (!summary) return null;
      return { dimension_key, minutes, difficulty, summary, effective };
    })
    .filter(Boolean);

  const overall_note = typeof parsed.overall_note === 'string' ? parsed.overall_note : '';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  return { activities: normalized, overall_note, confidence };
}

function resolveOpenAiCompatibleChatCompletionsUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  if (!b) return '';
  // If user provides the full endpoint already, respect it.
  if (/\/chat\/completions\/?$/i.test(b) || /\/v1\/chat\/completions\/?$/i.test(b)) return b;
  // Volcengine Ark commonly uses /api/v3/chat/completions (OpenAI-compatible).
  if (/\/api\/v3$/i.test(b) || /\/api\/v3\//i.test(b)) return `${b.replace(/\/+$/, '')}/chat/completions`;
  // Default OpenAI-style path.
  return `${b}/v1/chat/completions`;
}

async function callOpenAiCompatibleLLM({ dateStr, text, hint_dimension_key }, cfg) {
  if (!cfg?.base_url || !cfg?.api_key || !cfg?.model) {
    throw new Error('LLM 未配置：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL');
  }
  const url = resolveOpenAiCompatibleChatCompletionsUrl(cfg.base_url);
  if (!url) throw new Error('LLM base_url 无效');
  const hint = String(hint_dimension_key || '').trim();
  const allowed = Array.isArray(arguments?.[0]?.allowed_dimension_keys)
    ? arguments[0].allowed_dimension_keys.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const system = [
    '你是“人生努力可视化系统”的行为解析器。',
    '你必须只输出严格的 JSON（不要 Markdown，不要解释）。',
    '输出必须符合以下规则：',
    '- activities 是数组',
    allowed.length ? `- dimension_key 只能是：${allowed.join(', ')}` : '- dimension_key 为维度 key（必须从允许列表中选择）',
    '- minutes 为整数，范围 0~360',
    '- difficulty 只能是：easy, normal, hard',
    '- effective 为 true/false',
    '- summary 为简短中文',
    '- overall_note 为简短中文',
    '- confidence 为 0~1 小数',
    hint ? `重要：本次记录已指定归属维度为 ${hint}，请将 activities[*].dimension_key 全部输出为该值（不要输出其他维度）。` : ''
  ].filter(Boolean).join('\n');

  const user = `日期：${dateStr}\n用户输入：${text}\n${hint ? `归属维度（强制）：${hint}` : ''}\n请输出 JSON。`;
  const body = {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    // Best-effort for providers that support it; harmless otherwise
    response_format: { type: 'json_object' }
  };

  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${cfg.api_key}`
  };

  const attempt = async () => {
    const resp = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 20000);
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${raw.slice(0, 200)}`);
    const json = safeJsonParse(raw);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 返回缺少 message.content');
    return safeJsonParse(content);
  };

  try {
    return await attempt();
  } catch (e) {
    // retry once
    return await attempt();
  }
}

async function callAnthropicCompatibleLLM({ dateStr, text, hint_dimension_key }, cfg) {
  if (!cfg?.base_url || !cfg?.auth_token || !cfg?.model) {
    throw new Error('Anthropic LLM 未配置：请设置 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL');
  }
  const url = `${cfg.base_url}/v1/messages`;
  const hint = String(hint_dimension_key || '').trim();
  const allowed = Array.isArray(arguments?.[0]?.allowed_dimension_keys)
    ? arguments[0].allowed_dimension_keys.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const system = [
    '你是“人生努力可视化系统”的行为解析器。',
    '你必须只输出严格的 JSON（不要 Markdown，不要解释）。',
    '输出必须符合以下规则：',
    '- activities 是数组',
    allowed.length ? `- dimension_key 只能是：${allowed.join(', ')}` : '- dimension_key 为维度 key（必须从允许列表中选择）',
    '- minutes 为整数，范围 0~360',
    '- difficulty 只能是：easy, normal, hard',
    '- effective 为 true/false',
    '- summary 为简短中文',
    '- overall_note 为简短中文',
    '- confidence 为 0~1 小数',
    hint ? `重要：本次记录已指定归属维度为 ${hint}，请将 activities[*].dimension_key 全部输出为该值（不要输出其他维度）。` : ''
  ].filter(Boolean).join('\n');

  const user = `日期：${dateStr}\n用户输入：${text}\n${hint ? `归属维度（强制）：${hint}` : ''}\n请输出 JSON。`;
  const body = {
    model: cfg.model,
    max_tokens: 1200,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content: user }]
  };

  const headers = {
    'content-type': 'application/json',
    'x-api-key': cfg.auth_token,
    'anthropic-version': '2023-06-01'
  };

  const attempt = async () => {
    const resp = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 20000);
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${raw.slice(0, 200)}`);
    const json = safeJsonParse(raw);
    const contentBlocks = Array.isArray(json?.content) ? json.content : [];
    const textBlock = contentBlocks.find(b => b?.type === 'text' && typeof b?.text === 'string');
    if (!textBlock?.text) throw new Error('LLM 返回缺少 content.text');
    return safeJsonParse(textBlock.text);
  };

  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

async function parseWithLLM(payload) {
  const cfg = await ensureRuntimeLlmConfigLoaded();
  const provider = cfg.provider || 'openai';
  if (provider === 'anthropic') return callAnthropicCompatibleLLM(payload, cfg.anthropic);
  if (provider === 'openai') return callOpenAiCompatibleLLM(payload, cfg.openai);
  throw new Error(`不支持的 LLM_PROVIDER: ${provider}`);
}

async function callPlanDirectionLLM({ goal, context, stages }, cfg, provider) {
  const stageText = (Array.isArray(stages) ? stages : [])
    .map((s, i) => `${i + 1}. ${String(s?.title || '阶段')} (${String(s?.status || 'active')})`)
    .join('\n');
  const system = [
    '你是“AI 人生升级游戏”的规划助手。',
    '你必须只输出严格 JSON（不要 Markdown，不要解释）。',
    '输出字段：',
    '- main_line: string，3-6 句中文，描述中长期主线',
    '- today_actions: string[]，1-3 条，今天可执行的具体行动'
  ].join('\n');
  const user = [
    `目标：${goal}`,
    `现状：${context || '未提供'}`,
    `已有阶段：\n${stageText || '暂无'}`,
    '请基于以上信息输出 JSON。'
  ].join('\n');

  if (provider === 'anthropic') {
    if (!cfg?.base_url || !cfg?.auth_token || !cfg?.model) {
      throw new Error('Anthropic LLM 未配置');
    }
    const url = `${cfg.base_url}/v1/messages`;
    const body = {
      model: cfg.model,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }]
    };
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.auth_token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    }, 25000);
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${raw.slice(0, 200)}`);
    const json = safeJsonParse(raw);
    const textBlock = Array.isArray(json?.content) ? json.content.find(b => b?.type === 'text' && typeof b?.text === 'string') : null;
    return safeJsonParse(textBlock?.text || '{}');
  }

  if (!cfg?.base_url || !cfg?.api_key || !cfg?.model) {
    throw new Error('LLM 未配置：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL');
  }
  const url = resolveOpenAiCompatibleChatCompletionsUrl(cfg.base_url);
  const body = {
    model: cfg.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    response_format: { type: 'json_object' }
  };
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${cfg.api_key}`
    },
    body: JSON.stringify(body)
  }, 25000);
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${raw.slice(0, 200)}`);
  const json = safeJsonParse(raw);
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回缺少 message.content');
  return safeJsonParse(content);
}

async function planDirectionWithLLM(payload) {
  const cfg = await ensureRuntimeLlmConfigLoaded();
  const provider = cfg.provider || 'openai';
  const llmCfg = provider === 'anthropic' ? cfg.anthropic : cfg.openai;
  return callPlanDirectionLLM(payload, llmCfg, provider);
}

function normalizePlanDirectionResult(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('LLM 输出格式错误');
  const main_line = String(parsed.main_line || parsed.mainLine || '').trim();
  const actionsRaw = parsed.today_actions || parsed.todayActions || parsed.actions || [];
  const today_actions = (Array.isArray(actionsRaw) ? actionsRaw : [actionsRaw])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!main_line && !today_actions.length) throw new Error('LLM 未返回有效规划内容');
  return { main_line, today_actions };
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(ROOT));

app.get('/', async (req, res) => {
  try {
    const html = await fs.readFile(HTML_FILE, 'utf-8');
    res.type('html').send(html);
  } catch (error) {
    res.status(500).send(`页面读取失败: ${error.message}`);
  }
});

app.get('/fengdingding-progress.html', async (req, res) => {
  try {
    const html = await fs.readFile(HTML_FILE, 'utf-8');
    res.type('html').send(html);
  } catch (error) {
    res.status(500).send(`页面读取失败: ${error.message}`);
  }
});

app.get('/api/progress', async (req, res) => {
  try {
    await seedDbFromJsonIfNeeded();
    const data = getLatestProgressOrThrow();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: `读取进度失败: ${error.message}` });
  }
});

app.get('/api/health', async (req, res) => {
  const cfg = await ensureRuntimeLlmConfigLoaded();
  const openaiConfigured = Boolean(cfg.openai.base_url && cfg.openai.api_key && cfg.openai.model);
  const anthropicConfigured = Boolean(cfg.anthropic.base_url && cfg.anthropic.auth_token && cfg.anthropic.model);
  const activeConfigured = cfg.provider === 'anthropic' ? anthropicConfigured : openaiConfigured;
  res.json({
    ok: true,
    llm: activeConfigured,
    provider: cfg.provider,
    providers: {
      openai: { configured: openaiConfigured },
      anthropic: { configured: anthropicConfigured }
    }
  });
});

app.get('/api/llm-config', async (req, res) => {
  try {
    const cfg = await ensureRuntimeLlmConfigLoaded();
    res.json({ ok: true, config: toPublicLlmConfig(cfg) });
  } catch (error) {
    res.status(500).json({ error: `读取 LLM 配置失败: ${error.message}` });
  }
});

app.post('/api/llm-config', async (req, res) => {
  try {
    const current = await ensureRuntimeLlmConfigLoaded();
    const provider = String(req.body?.provider || current.provider || 'openai').trim().toLowerCase();
    const incoming = {
      provider,
      openai: {
        base_url: String(req.body?.openai?.base_url ?? current.openai.base_url ?? ''),
        api_key: String(req.body?.openai?.api_key ?? current.openai.api_key ?? ''),
        model: String(req.body?.openai?.model ?? current.openai.model ?? '')
      },
      anthropic: {
        base_url: String(req.body?.anthropic?.base_url ?? current.anthropic.base_url ?? ''),
        auth_token: String(req.body?.anthropic?.auth_token ?? current.anthropic.auth_token ?? ''),
        model: String(req.body?.anthropic?.model ?? current.anthropic.model ?? '')
      }
    };
    const next = normalizeLlmConfig(incoming, current);
    await saveRuntimeLlmConfig(next);
    res.json({ ok: true, config: toPublicLlmConfig(next) });
  } catch (error) {
    res.status(500).json({ error: `保存 LLM 配置失败: ${error.message}` });
  }
});

app.post('/api/llm-config/test', async (req, res) => {
  try {
    const current = await ensureRuntimeLlmConfigLoaded();
    const incoming = {
      provider: String(req.body?.provider || current.provider || 'openai'),
      openai: {
        base_url: String(req.body?.openai?.base_url ?? current.openai.base_url ?? ''),
        api_key: String(req.body?.openai?.api_key ?? current.openai.api_key ?? ''),
        model: String(req.body?.openai?.model ?? current.openai.model ?? '')
      },
      anthropic: {
        base_url: String(req.body?.anthropic?.base_url ?? current.anthropic.base_url ?? ''),
        auth_token: String(req.body?.anthropic?.auth_token ?? current.anthropic.auth_token ?? ''),
        model: String(req.body?.anthropic?.model ?? current.anthropic.model ?? '')
      }
    };
    const cfg = normalizeLlmConfig(incoming, current);
    if (cfg.provider === 'anthropic') {
      await callAnthropicCompatibleLLM({ dateStr: new Date().toISOString().slice(0, 10), text: '今天看文献1小时' }, cfg.anthropic);
    } else {
      await callOpenAiCompatibleLLM({ dateStr: new Date().toISOString().slice(0, 10), text: '今天看文献1小时' }, cfg.openai);
    }
    res.json({ ok: true, provider: cfg.provider, message: '连接测试成功' });
  } catch (error) {
    res.status(422).json({ error: `连接测试失败: ${error.message}` });
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: '请求体必须是 JSON 对象' });
    }

    // Basic structure guard
    if (!payload.dimensions || !payload.history) {
      return res.status(400).json({ error: '缺少必要字段 dimensions/history' });
    }

    // Guard against accidental full-payload encoding damage (e.g. UTF-8 -> '?').
    const incomingAnomalies = countEncodingAnomalyStrings(payload);
    try {
      const latest = getLatestProgressOrThrow();
      const latestAnomalies = countEncodingAnomalyStrings(latest);
      const anomalySpike = incomingAnomalies >= 30 && incomingAnomalies > (latestAnomalies * 3 + 20);
      if (anomalySpike) {
        return res.status(422).json({
          error: '检测到文本编码异常：本次保存中出现大量乱码，已拦截写入（请检查终端/脚本编码是否为 UTF-8）。'
        });
      }
    } catch {
      // no previous snapshot: skip comparison
    }

    const savedAt = new Date().toISOString();
    insertSnapshotStmt.run({
      saved_at: savedAt,
      source: 'api',
      payload: JSON.stringify(payload)
    });
    await writeJsonBackupAndCurrent(payload);
    res.json({ ok: true, saved_at: savedAt, storage: 'sqlite+json' });
  } catch (error) {
    res.status(500).json({ error: `写入进度失败: ${error.message}` });
  }
});

app.post('/api/plan/direction', async (req, res) => {
  try {
    const goal = String(req.body?.goal || '').trim();
    const context = String(req.body?.context || '').trim();
    const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
    if (!goal) return res.status(400).json({ error: 'goal 不能为空' });
    const llmRaw = await planDirectionWithLLM({ goal, context, stages });
    const parsed = normalizePlanDirectionResult(llmRaw);
    res.json({ ok: true, ...parsed });
  } catch (error) {
    const msg = String(error?.message || error);
    let status = 500;
    if (msg.includes('未配置')) status = 503;
    else if (msg.includes('格式错误') || msg.includes('合法 JSON') || msg.includes('未返回有效')) status = 422;
    res.status(status).json({ error: `规划失败: ${msg}` });
  }
});

app.post('/api/ingest/text', async (req, res) => {
  try {
    await seedDbFromJsonIfNeeded();
    const dateStr = String(req.body?.date || new Date().toISOString().slice(0, 10));
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text 不能为空' });

    const progress = getLatestProgressOrThrow();
    ensureDimensionDefs(progress);
    ensureDimensions(progress);
    if (!Array.isArray(progress.history)) progress.history = [];

    const enabledDims = getEnabledDimensionKeySet(progress, req.body);
    const hint_dimension_key = normalizeDimensionKey(req.body?.hint_dimension_key);
    if (hint_dimension_key && !enabledDims.has(hint_dimension_key)) {
      return res.status(422).json({ error: `hint_dimension_key=${hint_dimension_key} 已被禁用，无法入账。` });
    }

    const llmRaw = await parseWithLLM({ dateStr, text, hint_dimension_key, allowed_dimension_keys: Array.from(enabledDims) });
    const parsed = validateAndNormalizeParsed(llmRaw, enabledDims);
    if (hint_dimension_key && Array.isArray(parsed.activities) && parsed.activities.length > 0) {
      parsed.activities = parsed.activities.map(a => ({ ...a, dimension_key: hint_dimension_key }));
    }

    const applied_entries = [];
    const dayLog = ensureDailyLog(progress, dateStr);
    const baseRateByDim = getBaseRateByDim(progress);

    for (const a of parsed.activities) {
      if (!enabledDims.has(a.dimension_key)) continue;
      const exp = calcExp(a, baseRateByDim);
      if (!exp) continue; // ineffective=0 或 minutes=0 时不入账
      const entry = {
        date: dateStr,
        dimension_key: a.dimension_key,
        task_type: getDimLabel(progress, a.dimension_key),
        difficulty: `AI解析·${a.difficulty}·${a.minutes}min`,
        description: a.summary,
        exp_gained: exp,
        completed: true
      };
      applied_entries.push(entry);
      progress.history.push(entry);
      progress.dimensions[a.dimension_key].total_exp += exp;
      progress.total_exp = (Number(progress.total_exp) || 0) + exp;
      dayLog.entries.push(entry);
      dayLog.day_total_exp += exp;
      if (!dayLog.dimensions_touched.includes(a.dimension_key)) dayLog.dimensions_touched.push(a.dimension_key);
    }

    recomputeLevels(progress);

    // Persist snapshot + json backup
    const savedAt = new Date().toISOString();
    insertSnapshotStmt.run({
      saved_at: savedAt,
      source: 'ingest_text',
      payload: JSON.stringify(progress)
    });
    await writeJsonBackupAndCurrent(progress);

    res.json({ ok: true, parsed, applied_entries, progress });
  } catch (error) {
    const msg = String(error?.message || error);
    let status = 500;
    if (msg.includes('text 不能为空')) status = 400;
    else if (msg.includes('LLM 未配置') || msg.includes('Anthropic LLM 未配置') || msg.includes('LLM_PROVIDER')) status = 503;
    else if (msg.includes('格式错误') || msg.includes('合法 JSON')) status = 422;
    res.status(status).json({ error: `AI 入账失败: ${msg}` });
  }
});

app.listen(PORT, () => {
  console.log(`Progress server running at http://localhost:${PORT}`);
});
