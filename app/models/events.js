export const EVENT_CODES = {
  PAUSE: "pause",
  RESUME: "resume",
  SKIP: "skip",
  REST_START: "rest_start",
  REST_EXTEND: "rest_extend",
  REST_END: "rest_end",
  END_SESSION: "end_session",
  SESSION_COMPLETE: "session_complete",
  POST_FEEDBACK_SUBMIT: "post_feedback_submit"
};

export const EVENT_CODE_SET = new Set(Object.values(EVENT_CODES));

export function assertEventCode(eventCode) {
  if (!EVENT_CODE_SET.has(eventCode)) {
    throw new Error(`Invalid event_code: ${eventCode}`);
  }
}
