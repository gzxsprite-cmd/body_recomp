import { TimerEngine } from "./core/timerEngine.js";
import { parseAndValidateSessionScript } from "./core/sessionScriptValidator.js";
import { saveLastSessionData, loadLastSessionData } from "./storage/localStore.js";

const SAVE_PROXY_URL = "http://127.0.0.1:8765/save-session";
const TODAY_SESSION_URL = "http://127.0.0.1:8765/today-session";

const state = {
  page: "load",
  script: null,
  scriptFilePath: null,
  todaySessionStatus: null,
  engine: null,
  feedbackSubmitted: false,
  sessionResult: null,
  eventLogs: [],
  importMessage: "",
  importError: "",
  autoSaveStatus: null
};

const app = document.getElementById("app");

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function labelRequirement(step) {
  return step.action_type === "timed" ? `${step.target_seconds} 秒` : `${step.target_reps} 次`;
}

function render() {
  if (state.page === "load") renderLoadPage();
  if (state.page === "run") renderRunPage();
  if (state.page === "feedback") renderFeedbackPage();
}

async function loadDefaultSample() {
  const resp = await fetch("./data/sample_session_script.json");
  state.script = await resp.json();
  state.scriptFilePath = null;
}

async function init() {
  try {
    const resp = await fetch(TODAY_SESSION_URL);
    if (!resp.ok) {
      await loadDefaultSample();
      state.todaySessionStatus = "TODAY_SESSION_PROXY_UNAVAILABLE";
      render();
      return;
    }

    const data = await resp.json();
    if (data.success) {
      state.script = data.session_script;
      state.scriptFilePath = data.session_file_path;
      state.todaySessionStatus = null;
      render();
      return;
    }

    if (data.status_code === "NO_SESSION_FOR_TODAY") {
      state.todaySessionStatus = "NO_SESSION_FOR_TODAY";
      state.script = null;
      state.scriptFilePath = null;
      render();
      return;
    }

    state.todaySessionStatus = data.status_code || "TODAY_SESSION_LOAD_FAILED";
    state.script = null;
    state.scriptFilePath = null;
    render();
  } catch (_e) {
    await loadDefaultSample();
    state.todaySessionStatus = "TODAY_SESSION_PROXY_UNAVAILABLE";
    render();
  }
}

function applyImportedScript(rawText, sourceLabel) {
  const { valid, error, script } = parseAndValidateSessionScript(rawText);
  if (!valid) {
    state.importError = error;
    state.importMessage = "";
    render();
    return;
  }

  state.script = script;
  state.scriptFilePath = null;
  state.todaySessionStatus = null;
  state.importError = "";
  state.importMessage = `已成功导入：${script.session_name}（来源：${sourceLabel}）`;
  render();
}

function createSaveTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function autoSaveSessionFiles(sessionResult, eventLogs, completedSteps) {
  const response = await fetch(SAVE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_result: sessionResult,
      event_logs: eventLogs,
      session_name: sessionResult.session_name,
      session_file_path: state.scriptFilePath,
      completed_steps: completedSteps,
      timestamp: createSaveTimestamp()
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_e) {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

function restartCurrentSession() {
  const confirmed = window.confirm("确认重新开始本次训练？当前进度和未提交事件将被清空。");
  if (!confirmed) return;

  state.engine = new TimerEngine(state.script);
  state.engine.startSession();
  state.feedbackSubmitted = false;
  state.sessionResult = null;
  state.eventLogs = [];
  state.autoSaveStatus = null;
  state.page = "run";
  startTicker();
  render();
}

function renderLoadPage() {
  const steps = state.script?.steps ?? [];
  const plannedSets = steps.reduce((acc, s) => acc + s.sets, 0);
  const lastData = loadLastSessionData();
  app.innerHTML = `
    <section class="card surface-primary">
      <h1 class="page-title">训练计时器 MVP</h1>
      <div class="info-grid">
        <p><span class="k">Session</span><span>${state.script ? state.script.session_name : "未加载"}</span></p>
        <p><span class="k">Step 数</span><span>${state.script ? state.script.total_steps : "-"}</span></p>
        <p><span class="k">计划组数</span><span>${state.script ? plannedSets : "-"}</span></p>
      </div>
      ${state.todaySessionStatus === "NO_SESSION_FOR_TODAY" ? '<p class="error-msg">NO_SESSION_FOR_TODAY：今天没有可执行课程，请手动导入 Session Script。</p>' : ""}
      ${state.todaySessionStatus === "TODAY_SESSION_PROXY_UNAVAILABLE" ? '<p class="error-msg">自动定位服务不可用，已回退到内置示例。</p>' : ""}
      ${state.importMessage ? `<p class="ok-msg">${state.importMessage}</p>` : ""}
      ${state.importError ? `<p class="error-msg">${state.importError}</p>` : ""}
      <button id="start-session" class="touch-btn touch-btn-primary" ${state.script ? "" : "disabled"}>开始训练</button>
    </section>

    <section class="card">
      <h2 class="section-title">导入 Session Script JSON</h2>
      <label>方式1：文件选择导入（.json）
        <input id="script-file-input" type="file" accept=".json,application/json" />
      </label>
      <label>方式2：文本粘贴导入
        <textarea id="script-text-input" rows="8" placeholder='粘贴 Day1 Session Script JSON...'></textarea>
      </label>
      <button id="import-text-btn" class="touch-btn">导入粘贴内容</button>
    </section>

    <section class="card">
      <h2 class="section-title">最近一次本地记录</h2>
      <p>${lastData.sessionResult ? `最近训练：${lastData.sessionResult.session_name}` : "暂无"}</p>
    </section>
  `;

  const startBtn = document.getElementById("start-session");
  if (state.script) {
    startBtn.onclick = () => {
      state.engine = new TimerEngine(state.script);
      state.engine.startSession();
      state.autoSaveStatus = null;
      state.page = "run";
      startTicker();
      render();
    };
  }

  const fileInput = document.getElementById("script-file-input");
  fileInput.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rawText = await file.text();
    applyImportedScript(rawText, `文件：${file.name}`);
  };

  document.getElementById("import-text-btn").onclick = () => {
    const rawText = document.getElementById("script-text-input").value.trim();
    if (!rawText) {
      state.importError = "导入失败：请先粘贴 JSON 内容。";
      state.importMessage = "";
      render();
      return;
    }
    applyImportedScript(rawText, "文本粘贴");
  };
}

let ticker = null;
function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    if (!state.engine) return;
    state.engine.tick();
    if (["completed", "ended_early"].includes(state.engine.status)) {
      clearInterval(ticker);
      state.page = "feedback";
    }
    render();
  }, 1000);
}

function renderRunPage() {
  const engine = state.engine;
  const step = engine.currentStep;
  if (!step) {
    state.page = "feedback";
    render();
    return;
  }

  const requirement = labelRequirement(step);
  app.innerHTML = `
    <section class="card surface-primary">
      <h1 class="page-title">训练执行页</h1>
      <p class="action-name">${step.action_name}</p>
      <div class="hero-grid">
        <div class="hero-item">
          <p class="hero-label">动作要求</p>
          <p class="hero-value">${requirement}</p>
        </div>
        <div class="hero-item">
          <p class="hero-label">当前组数</p>
          <p class="hero-value">${engine.currentSet}/${step.sets}</p>
        </div>
        <div class="hero-item">
          <p class="hero-label">动作倒计时</p>
          <p class="hero-value hero-timer">${step.action_type === "timed" ? engine.remainingSeconds : "Reps"}</p>
        </div>
        <div class="hero-item">
          <p class="hero-label">休息倒计时</p>
          <p class="hero-value hero-timer">${engine.isResting ? engine.restRemainingSeconds : "-"}</p>
        </div>
      </div>

      <div class="minor-info">
        <p><span class="k">整体进度</span><span>${step.step_no}/${state.script.total_steps}</span></p>
        <p><span class="k">下一动作</span><span>${engine.nextStep ? engine.nextStep.action_name : "无（最后一项）"}</span></p>
      </div>
      <p class="safe-tip"><strong>安全提示：</strong>${step.safety_tip || "无"}</p>
    </section>

    <section class="card">
      <h2 class="section-title">训练控制</h2>
      <div class="touch-grid">
        <button id="pause-btn" class="touch-btn touch-btn-primary">${engine.isPaused ? "继续" : "暂停"}</button>
        <button id="rest-btn" class="touch-btn">休息 (60s)</button>
        <button id="rest-plus-btn" class="touch-btn" ${engine.isResting ? "" : "disabled"}>+60秒</button>
        <button id="skip-btn" class="touch-btn">跳过</button>
        <button id="rep-complete-btn" class="touch-btn" ${step.action_type === "reps" ? "" : "disabled"}>完成当前组</button>
        <button id="restart-btn" class="touch-btn touch-btn-warning">重新开始</button>
      </div>
      <div class="danger-zone">
        <button id="end-btn" class="touch-btn touch-btn-danger">结束训练</button>
      </div>
    </section>
  `;

  document.getElementById("pause-btn").onclick = () => {
    if (engine.isPaused) engine.resume(); else engine.pause();
    render();
  };
  document.getElementById("skip-btn").onclick = () => {
    engine.skip();
    if (engine.status === "completed") state.page = "feedback";
    render();
  };
  document.getElementById("rest-btn").onclick = () => {
    engine.startRest(60);
    render();
  };
  document.getElementById("rest-plus-btn").onclick = () => {
    engine.extendRest(60);
    render();
  };
  document.getElementById("rep-complete-btn").onclick = () => {
    engine.completeRepSet();
    render();
  };
  document.getElementById("restart-btn").onclick = () => {
    restartCurrentSession();
  };
  document.getElementById("end-btn").onclick = () => {
    engine.endSession();
    state.page = "feedback";
    render();
  };
}

function renderFeedbackPage() {
  const engine = state.engine;
  const needSkipReason = engine.eventLogs.some((e) => e.event_code === "skip");
  const needEndReason = engine.eventLogs.some((e) => e.event_code === "end_session");

  app.innerHTML = `
    <section class="card surface-primary">
      <h1 class="page-title">训练后反馈与导出</h1>
      <form id="feedback-form">
        <label>整体难度
          <select name="overall_difficulty" required>
            <option value="easy">太简单</option>
            <option value="just_right" selected>刚好</option>
            <option value="hard">太难</option>
          </select>
        </label>
        <label>主观疲劳评分(1-10)
          <input name="fatigue_score" type="number" min="1" max="10" value="5" required />
        </label>
        <label>疼痛/不适位置（可选）
          <input name="discomfort_notes" type="text" placeholder="例如：左膝" />
        </label>
        ${needSkipReason ? '<label>跳过原因 <textarea name="skip_reason_text" required></textarea></label>' : ""}
        ${needEndReason ? '<label>提前结束原因 <textarea name="end_reason_text" required></textarea></label>' : ""}
        <button type="submit" class="touch-btn touch-btn-primary">提交反馈</button>
      </form>

      ${state.autoSaveStatus ? `<p class="${state.autoSaveStatus.type === "success" ? "ok-msg" : "error-msg"}">${state.autoSaveStatus.message}</p>` : ""}

      <div id="export-panel" ${state.feedbackSubmitted ? "" : "class=hidden"}>
        <h2 class="section-title">导出 JSON</h2>
        <div class="touch-grid">
          <button id="export-result" class="touch-btn">导出 Session Result</button>
          <button id="export-events" class="touch-btn">导出 Event Logs</button>
        </div>
      </div>
      <div id="summary"></div>
      <button id="back-home" class="touch-btn">返回首页</button>
    </section>
  `;

  const summary = document.getElementById("summary");
  if (state.sessionResult) {
    summary.innerHTML = `
      <h2 class="section-title">Session Result 摘要</h2>
      <pre>${JSON.stringify(state.sessionResult, null, 2)}</pre>
    `;
  }

  document.getElementById("feedback-form").onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const feedback = Object.fromEntries(formData.entries());

    engine.submitFeedback({
      difficulty_rating: feedback.overall_difficulty === "easy" ? "too_easy" :
        feedback.overall_difficulty === "hard" ? "too_hard" : "just_right",
      fatigue_score_1_10: Number(feedback.fatigue_score),
      pain_text: feedback.discomfort_notes || "",
      skip_reason_text: feedback.skip_reason_text || "",
      end_reason_text: feedback.end_reason_text || ""
    });

    state.sessionResult = engine.buildSessionResult(feedback);
    state.eventLogs = engine.eventLogs;
    saveLastSessionData(state.sessionResult, state.eventLogs);
    state.feedbackSubmitted = true;

    const completedSteps = Array.from(engine.completedSteps || []).sort((a, b) => Number(a) - Number(b));

    try {
      const saveResult = await autoSaveSessionFiles(state.sessionResult, state.eventLogs, completedSteps);
      state.autoSaveStatus = {
        type: "success",
        message: `自动保存成功：${saveResult.run_file_path || saveResult.saved_dir}`
      };
    } catch (err) {
      state.autoSaveStatus = {
        type: "error",
        message: `自动保存失败：${err.message}。你仍可使用下方按钮手动导出 JSON。`
      };
    }

    render();
  };

  const resultBtn = document.getElementById("export-result");
  const eventsBtn = document.getElementById("export-events");
  if (resultBtn) {
    resultBtn.onclick = () => downloadJson("session_result.json", state.sessionResult);
    eventsBtn.onclick = () => downloadJson("event_logs.json", state.eventLogs);
  }

  document.getElementById("back-home").onclick = () => {
    state.page = "load";
    state.engine = null;
    state.feedbackSubmitted = false;
    state.sessionResult = null;
    state.eventLogs = [];
    state.autoSaveStatus = null;
    render();
  };
}

init();
