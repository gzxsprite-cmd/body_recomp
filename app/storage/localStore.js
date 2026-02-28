const KEYS = {
  LAST_RESULT: "timer_mvp_last_session_result",
  LAST_EVENTS: "timer_mvp_last_event_logs"
};

export function saveLastSessionData(sessionResult, eventLogs) {
  localStorage.setItem(KEYS.LAST_RESULT, JSON.stringify(sessionResult, null, 2));
  localStorage.setItem(KEYS.LAST_EVENTS, JSON.stringify(eventLogs, null, 2));
}

export function loadLastSessionData() {
  const resultRaw = localStorage.getItem(KEYS.LAST_RESULT);
  const eventRaw = localStorage.getItem(KEYS.LAST_EVENTS);
  return {
    sessionResult: resultRaw ? JSON.parse(resultRaw) : null,
    eventLogs: eventRaw ? JSON.parse(eventRaw) : []
  };
}
