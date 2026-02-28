import { EVENT_CODES, assertEventCode } from "../models/events.js";

function isoNow() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export class TimerEngine {
  constructor(sessionScript) {
    this.script = sessionScript;
    this.stepIndex = 0;
    this.currentSet = 1;
    this.remainingSeconds = this.currentStep?.target_seconds || 0;
    this.restRemainingSeconds = 0;
    this.restTotalSeconds = 0;
    this.isPaused = false;
    this.isResting = false;
    this.status = "idle";
    this.startedAt = null;
    this.endedAt = null;
    this.completedSteps = new Set();
    this.completedSets = 0;
    this.eventLogs = [];
    this.hasSkip = false;
    this.hasEndedEarly = false;
    this.endedOnStepNo = null;
    this.endedOnActionName = null;
  }

  get currentStep() {
    return this.script.steps[this.stepIndex] || null;
  }

  get nextStep() {
    return this.script.steps[this.stepIndex + 1] || null;
  }

  startSession() {
    this.status = "running";
    this.startedAt = isoNow();
    if (this.currentStep?.action_type === "timed") {
      this.remainingSeconds = this.currentStep.target_seconds;
    }
  }

  tick() {
    if (this.status !== "running" || this.isPaused) return;

    if (this.isResting) {
      if (this.restRemainingSeconds > 0) {
        this.restRemainingSeconds -= 1;
      }
      if (this.restRemainingSeconds <= 0) {
        this.logEvent(EVENT_CODES.REST_END, {
          rest_seconds_actual: this.restTotalSeconds
        });
        this.isResting = false;
        this.restTotalSeconds = 0;
      }
      return;
    }

    const step = this.currentStep;
    if (!step) return;

    if (step.action_type === "timed") {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds -= 1;
      }
      if (this.remainingSeconds <= 0) {
        this.finishCurrentSet();
      }
    }
  }

  finishCurrentSet() {
    const step = this.currentStep;
    if (!step) return;

    this.completedSets += 1;
    if (this.currentSet >= step.sets) {
      this.completedSteps.add(step.step_no);
      this.moveToNextStep();
      return;
    }

    this.currentSet += 1;
    this.startRest(step.rest_seconds);
  }

  completeRepSet() {
    if (this.status !== "running" || this.isResting) return;
    const step = this.currentStep;
    if (!step || step.action_type !== "reps") return;
    this.finishCurrentSet();
  }

  moveToNextStep() {
    this.stepIndex += 1;
    this.currentSet = 1;
    const step = this.currentStep;
    if (!step) {
      this.status = "completed";
      this.endedAt = isoNow();
      this.logEvent(EVENT_CODES.SESSION_COMPLETE, {
        completed_exercise_count: this.completedSteps.size,
        planned_exercise_count: this.script.total_steps,
        completed_set_count: this.completedSets,
        planned_set_count: this.getPlannedSetCount(),
        session_duration_seconds: this.getDurationSeconds()
      });
      return;
    }

    this.remainingSeconds = step.action_type === "timed" ? step.target_seconds : 0;
  }

  pause() {
    if (this.status !== "running" || this.isPaused) return;
    this.isPaused = true;
    this.logEvent(EVENT_CODES.PAUSE, this.basePayload());
  }

  resume() {
    if (this.status !== "running" || !this.isPaused) return;
    this.isPaused = false;
    this.logEvent(EVENT_CODES.RESUME, this.basePayload());
  }

  skip() {
    if (this.status !== "running") return;
    this.hasSkip = true;
    this.logEvent(EVENT_CODES.SKIP, this.basePayload());
    this.moveToNextStep();
  }

  startRest(seconds = 60) {
    if (this.status !== "running") return;
    this.isResting = true;
    this.restRemainingSeconds = seconds;
    this.restTotalSeconds = seconds;
    this.logEvent(EVENT_CODES.REST_START, {
      ...this.basePayload(),
      rest_seconds_planned: seconds
    });
  }

  extendRest(extra = 60) {
    if (this.status !== "running" || !this.isResting) return;
    this.restRemainingSeconds += extra;
    this.restTotalSeconds += extra;
    this.logEvent(EVENT_CODES.REST_EXTEND, {
      ...this.basePayload(),
      added_seconds: extra,
      rest_seconds_total_after: this.restTotalSeconds
    });
  }

  endSession() {
    if (!["running", "idle"].includes(this.status)) return;
    this.hasEndedEarly = true;
    this.status = "ended_early";
    this.endedAt = isoNow();
    this.endedOnStepNo = this.currentStep?.step_no || null;
    this.endedOnActionName = this.currentStep?.action_name || null;
    this.logEvent(EVENT_CODES.END_SESSION, this.basePayload());
  }

  submitFeedback(feedback) {
    this.logEvent(EVENT_CODES.POST_FEEDBACK_SUBMIT, {
      difficulty_rating: feedback.difficulty_rating,
      fatigue_score_1_10: feedback.fatigue_score_1_10,
      pain_text: feedback.pain_text || null,
      skip_reason_text: feedback.skip_reason_text || null,
      end_reason_text: feedback.end_reason_text || null
    });
  }

  buildSessionResult(feedback) {
    const endTime = this.endedAt || isoNow();
    return {
      session_id: this.script.session_id,
      session_name: this.script.session_name,
      start_time: this.startedAt,
      end_time: endTime,
      duration_seconds: this.getDurationSeconds(endTime),
      planned_steps: this.script.total_steps,
      completed_steps: this.completedSteps.size,
      planned_sets: this.getPlannedSetCount(),
      completed_sets: this.completedSets,
      ended_early: this.status === "ended_early",
      ended_on_step_no: this.status === "ended_early" ? this.endedOnStepNo : null,
      ended_on_action_name: this.status === "ended_early" ? this.endedOnActionName : null,
      overall_difficulty: feedback.overall_difficulty,
      fatigue_score: Number(feedback.fatigue_score),
      discomfort_notes: feedback.discomfort_notes || null
    };
  }

  getDurationSeconds(endTime) {
    if (!this.startedAt) return 0;
    const end = endTime ? new Date(endTime) : new Date();
    return Math.max(0, Math.round((end.getTime() - new Date(this.startedAt).getTime()) / 1000));
  }

  getPlannedSetCount() {
    return this.script.steps.reduce((sum, step) => sum + step.sets, 0);
  }

  basePayload() {
    const step = this.currentStep;
    return {
      phase: this.isResting ? "rest" : "work",
      set_index: step ? this.currentSet : null,
      set_total: step?.sets || null,
      remaining_seconds: this.isResting ? this.restRemainingSeconds : this.remainingSeconds
    };
  }

  logEvent(eventCode, payload = {}) {
    assertEventCode(eventCode);
    const step = this.currentStep;
    this.eventLogs.push({
      event_id: uid("evt"),
      session_id: this.script.session_id,
      event_code: eventCode,
      timestamp: isoNow(),
      step_no: step?.step_no || null,
      action_name: step?.action_name || null,
      payload
    });
  }
}
