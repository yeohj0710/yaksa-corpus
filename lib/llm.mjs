/**
 * OpenAI 호환 클라이언트. 의존성 없음(Node 22+ 내장 fetch).
 *
 * 함정 세 개를 미리 막아뒀습니다.
 *  - 모델에 따라 max_tokens / max_completion_tokens 이름이 다릅니다. 자동 재시도합니다.
 *  - 구조화 출력 스키마는 모든 프로퍼티가 required + additionalProperties:false 여야 합니다.
 *    nullable 은 anyOf 가 아니라 type:["string","null"] 로 씁니다. buildSchema 가 검사합니다.
 *  - 429/5xx 는 지수 백오프로 재시도합니다.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LLM, DIR } from "./config.mjs";

export const usage = { calls: 0, promptTokens: 0, completionTokens: 0, retries: 0, failures: 0, rateLimited: 0 };

/**
 * 호출 단위 사용량 로그. 프로세스가 죽어도 남습니다.
 * 리포트의 usage 는 그 프로세스 것만 세므로, 여러 번 나눠 돌리면 실제보다 적게 나옵니다.
 * 전량 실행처럼 며칠 걸리는 작업에서는 이 로그가 유일한 정확한 기록입니다.
 */
const USAGE_LOG = path.join(DIR.reports, "usage.jsonl");
function logUsage(rec) {
  try {
    mkdirSync(DIR.reports, { recursive: true });
    appendFileSync(USAGE_LOG, JSON.stringify({ t: new Date().toISOString(), ...rec }) + "\n", "utf8");
  } catch { /* 로깅 실패가 파이프라인을 멈추면 안 됩니다 */ }
}

const MAX_ATTEMPTS = Number(process.env.LLM_MAX_ATTEMPTS || 12);
const MAX_DELAY_MS = Number(process.env.LLM_MAX_DELAY_MS || 120_000);
const RUN_LIMIT_USD = Number(process.env.LLM_RUN_LIMIT_USD || 0);
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.20);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 1.20);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 지터를 섞습니다. 동시 요청이 같은 순간에 몰려 다시 429 를 맞는 걸 막습니다. */
const jitter = (ms) => Math.round(ms * (0.7 + Math.random() * 0.6));

/**
 * 유료 호출 킬스위치. 2026-08-04 에 걸었습니다.
 *
 * 이 저장소의 파이프라인은 Codex 구독이 아니라 .env 의 LLM_API_KEY 로
 * api.openai.com 을 직접 때립니다. 세션이 `node scripts/run-all.mjs` 한 줄만 쳐도
 * 스크립트가 알아서 수천 콜을 태웁니다. 실제로 8/4 에 66분 동안 701콜,
 * 입력 232만 토큰을 쓰고 20단계 중 2단계에서 멈췄습니다(reports/usage.jsonl).
 *
 * 그래서 기본값을 "차단"으로 뒤집었습니다. 키만 다시 채워 넣는 걸로는 안 풀립니다.
 * 정말로 돈을 쓸 때만 LLM_ENABLE=1 을 함께 주세요.
 */
function assertKey() {
  if (process.env.LLM_ENABLE !== "1") {
    throw new Error(
      "유료 LLM 호출이 차단돼 있습니다(2026-08-04).\n" +
      "  이 파이프라인은 Codex 구독이 아니라 OpenAI API 로 직접 과금됩니다.\n" +
      "  돌리려면 .env 의 LLM_API_KEY 를 채우고 LLM_ENABLE=1 을 같이 주세요.\n" +
      "    예) LLM_ENABLE=1 node scripts/run-all.mjs --from l1-microbiology\n" +
      "  먼저 `node scripts/cost.mjs` 로 예상 비용부터 확인하세요.",
    );
  }
  if (!LLM.apiKey) {
    throw new Error("LLM_API_KEY 가 비어 있습니다. .env.example 을 .env 로 복사해서 채우세요.");
  }
}

function spentUSD() {
  if (!RUN_LIMIT_USD) return 0;
  if (!existsSync(USAGE_LOG)) return 0;
  try {
    const rows = readFileSync(USAGE_LOG, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const cached = rows.reduce((n, r) => n + (r.cached ?? 0), 0);
    const input = rows.reduce((n, r) => n + (r.in ?? 0), 0) - cached;
    const output = rows.reduce((n, r) => n + (r.out ?? 0), 0);
    return (input / 1e6) * PRICE_IN + (output / 1e6) * PRICE_OUT;
  } catch (err) {
    const e = new Error(`사용량 로그를 읽지 못해 유료 호출을 안전하게 중단합니다: ${err.message}`);
    e.code = "LLM_BUDGET_CHECK_FAILED";
    e.stopPipeline = true;
    throw e;
  }
}

function assertBudget() {
  if (RUN_LIMIT_USD <= 0) return;
  const spent = spentUSD();
  if (spent >= RUN_LIMIT_USD) {
    const e = new Error(`LLM 비용 상한 도달: $${spent.toFixed(2)} >= $${RUN_LIMIT_USD.toFixed(2)}`);
    e.code = "LLM_BUDGET_EXCEEDED";
    e.stopPipeline = true;
    throw e;
  }
}

/**
 * @param {object} o
 * @param {string} o.model
 * @param {Array}  o.messages
 * @param {object} [o.schema]      JSON Schema. 주면 구조화 출력을 강제합니다.
 * @param {string} [o.schemaName]
 * @param {number} [o.maxTokens]
 */
export async function chat({ model, messages, schema, schemaName = "output", tag, maxTokens = 8000,
                             temperature = 0, promptCacheKey, promptCacheRetention }) {
  assertKey();
  assertBudget();
  let tokenField = "max_completion_tokens";
  // 최신 추론 모델은 temperature 커스텀을 거부합니다(기본 1만 허용).
  // 400 이 오면 필드를 떼고 한 번 다시 보냅니다.
  let sendTemperature = true;

  const body = () => {
    const b = { model, messages };
    if (sendTemperature) b.temperature = temperature;
    b[tokenField] = maxTokens;
    if (promptCacheKey) b.prompt_cache_key = promptCacheKey;
    if (promptCacheRetention) b.prompt_cache_retention = promptCacheRetention;
    if (schema) {
      b.response_format = {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      };
    }
    return b;
  };

  // 429 는 길게 참습니다. 여기서 포기하면 그 쪽은 quarantine 으로 빠지고
  // 다시 돌려야 하는데, 5,000쪽 규모에서는 재실행이 훨씬 비쌉니다.
  let delay = 2000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    assertBudget();
    let res;
    try {
      res = await fetch(`${LLM.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${LLM.apiKey}` },
        body: JSON.stringify(body()),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      usage.retries++;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(jitter(delay));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      usage.calls++;
      const pt = json.usage?.prompt_tokens ?? 0;
      const ct = json.usage?.completion_tokens ?? 0;
      const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      usage.promptTokens += pt;
      usage.completionTokens += ct;
      logUsage({ model, in: pt, out: ct, cached, tag: tag ?? schemaName ?? "text" });
      const text = json.choices?.[0]?.message?.content ?? "";
      const finish = json.choices?.[0]?.finish_reason;
      if (finish === "length") {
        throw new Error(`출력이 잘렸습니다(finish_reason=length). maxTokens=${maxTokens} 를 올리세요.`);
      }
      // 빈 응답을 성공으로 받으면 그 쪽이 조용히 비어 버립니다.
      // 실패로 올려서 quarantine 에 남기고 재실행 대상이 되게 합니다.
      if (!schema && text.trim().length === 0) {
        throw new Error("빈 응답을 받았습니다(내용 없음). 재시도 대상입니다.");
      }
      return schema ? JSON.parse(text) : text;
    }

    const errText = await res.text().catch(() => "");
    // max_tokens 이름 불일치는 한 번만 바꿔서 즉시 재시도
    if (/max_completion_tokens|max_tokens/i.test(errText) && tokenField === "max_completion_tokens") {
      tokenField = "max_tokens";
      continue;
    }
    // temperature 미지원 모델도 한 번만 떼고 재시도
    if (/temperature/i.test(errText) && sendTemperature) {
      sendTemperature = false;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      usage.retries++;
      if (res.status === 429) usage.rateLimited++;
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : jitter(delay));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      continue;
    }
    usage.failures++;
    throw new Error(`LLM ${res.status}: ${errText.slice(0, 400)}`);
  }
  usage.failures++;
  throw new Error(`LLM 재시도 한도 초과 (${MAX_ATTEMPTS}회). 동시 실행 중인 다른 단계가 있으면 멈추고 다시 돌리세요.`);
}

/**
 * 이미지 + 지시문. 쪽 전사에 씁니다.
 * imageBase64 한 장, 또는 imagesBase64 여러 장(문서 전체를 한 번에 보여줄 때).
 */
export async function vision({
  model = LLM.vision, system, prompt,
  imageBase64, imagesBase64, schema, schemaName, tag, maxTokens = 8000,
  promptCacheKey, promptCacheRetention,
}) {
  const imgs = imagesBase64 ?? (imageBase64 ? [imageBase64] : []);
  if (!imgs.length) throw new Error("이미지가 없습니다");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: prompt },
      ...imgs.map((b64) => ({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${b64}`, detail: "high" },
      })),
    ],
  });
  return chat({ model, messages, schema, schemaName, tag, maxTokens, promptCacheKey, promptCacheRetention });
}

/**
 * 구조화 출력 스키마 검증. strict 모드가 조용히 거부하는 조건을 미리 잡습니다.
 * 문제가 있으면 던집니다 — 5,300쪽 돌리고 나서 알면 늦습니다.
 */
export function assertStrictSchema(schema, pathStr = "$") {
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      throw new Error(`${pathStr}: additionalProperties:false 가 필요합니다`);
    }
    const props = Object.keys(schema.properties ?? {});
    const req = new Set(schema.required ?? []);
    const missing = props.filter((p) => !req.has(p));
    if (missing.length) {
      throw new Error(`${pathStr}: 모든 프로퍼티가 required 여야 합니다. 빠짐: ${missing.join(", ")}`);
    }
    for (const [k, v] of Object.entries(schema.properties ?? {})) assertStrictSchema(v, `${pathStr}.${k}`);
  }
  if (schema.type === "array" && schema.items) assertStrictSchema(schema.items, `${pathStr}[]`);
  if (schema.anyOf || schema.oneOf) {
    throw new Error(`${pathStr}: anyOf/oneOf 는 거부됩니다. nullable 은 type:["x","null"] 로 쓰세요`);
  }
  return true;
}

export function usageReport() {
  const { calls, promptTokens, completionTokens, retries, failures } = usage;
  return { calls, promptTokens, completionTokens, retries, failures,
           totalTokens: promptTokens + completionTokens };
}
