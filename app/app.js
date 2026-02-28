import { TimerEngine } from "./core/timerEngine.js";
import { saveLastSessionData, loadLastSessionData } from "./storage/localStore.js";

const state = {
  page: "load",
  script: null,
  engine: null,
  feedbackSubmitted: false,
  sessionResult: null,
  eventLogs: []
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

async function init() {
  const resp = await fetch("./data/sample_session_script.json");
  state.script = await resp.json();
  render();
}

function renderLoadPage() {
  const steps = state.script?.steps ?? [];
  const plannedSets = steps.reduce((acc, s) => acc + s.sets, 0);
  const lastData = loadLastSessionData();
  app.innerHTML = `
    <section class="card">
      <h1>训练计时器 MVP</h1>
      <p><strong>Session:</strong> ${state.script.session_name}</p>
      <p><strong>Step 数:</strong> ${state.script.total_steps}</p>
      <p><strong>计划组数:</strong> ${plannedSets}</p>
      <button id="start-session">开始训练</button>
    </section>
    <section class="card">
      <h2>最近一次本地记录</h2>
      <p>${lastData.sessionResult ? `最近训练：${lastData.sessionResult.session_name}` : "暂无"}</p>
    </section>
  `;

  document.getElementById("start-session").onclick = () => {
    state.engine = new TimerEngine(state.script);
    state.engine.startSession();
    state.page = "run";
    startTicker();
    render();
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
    <section class="card">
      <h1>训练执行页</h1>
      <p><strong>动作：</strong>${step.action_name}</p>
      <p><strong>要求：</strong>${requirement}</p>
      <p><strong>组数：</strong>${engine.currentSet}/${step.sets}</p>
      <p><strong>动作倒计时：</strong>${step.action_type === "timed" ? engine.remainingSeconds : "reps动作"}</p>
      <p><strong>休息倒计时：</strong>${engine.isResting ? engine.restRemainingSeconds : "-"}</p>
      <p><strong>下一动作：</strong>${engine.nextStep ? engine.nextStep.action_name : "无（最后一项）"}</p>
      <p><strong>整体进度：</strong>${step.step_no}/${state.script.total_steps}</p>
      <p class="safe-tip"><strong>安全提示：</strong>${step.safety_tip || "无"}</p>
      <div class="buttons">
        <button id="pause-btn">${engine.isPaused ? "继续" : "暂停"}</button>
        <button id="skip-btn">跳过</button>
        <button id="rest-btn">休息(60s)</button>
        <button id="rest-plus-btn" ${engine.isResting ? "" : "disabled"}>+60秒</button>
        <button id="rep-complete-btn" ${step.action_type === "reps" ? "" : "disabled"}>完成当前组</button>
        <button id="end-btn" class="danger">结束训练</button>
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
    <section class="card">
      <h1>训练后反馈与导出</h1>
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
        <button type="submit">提交反馈</button>
      </form>
      <div id="export-panel" ${state.feedbackSubmitted ? "" : "class=hidden"}>
        <h2>导出 JSON</h2>
        <button id="export-result">导出 Session Result</button>
        <button id="export-events">导出 Event Logs</button>
      </div>
      <div id="summary"></div>
      <button id="back-home">返回首页</button>
    </section>
  `;

  const summary = document.getElementById("summary");
  if (state.sessionResult) {
    summary.innerHTML = `
      <h2>Session Result 摘要</h2>
      <pre>${JSON.stringify(state.sessionResult, null, 2)}</pre>
    `;
  }

  document.getElementById("feedback-form").onsubmit = (e) => {
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
    render();
  };
}

init();
