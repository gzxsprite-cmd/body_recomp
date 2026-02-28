function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateSessionScript(script) {
  if (!isObject(script)) {
    return { valid: false, error: "导入失败：JSON 根节点必须是对象。" };
  }

  if (!script.session_id || typeof script.session_id !== "string") {
    return { valid: false, error: "导入失败：缺少必填字段 session_id（字符串）。" };
  }

  if (!script.session_name || typeof script.session_name !== "string") {
    return { valid: false, error: "导入失败：缺少必填字段 session_name（字符串）。" };
  }

  if (!Number.isInteger(script.total_steps) || script.total_steps <= 0) {
    return { valid: false, error: "导入失败：缺少必填字段 total_steps（正整数）。" };
  }

  if (!Array.isArray(script.steps) || script.steps.length === 0) {
    return { valid: false, error: "导入失败：缺少必填字段 steps（非空数组）。" };
  }

  if (script.steps.length !== script.total_steps) {
    return { valid: false, error: "导入失败：total_steps 与 steps 数量不一致。" };
  }

  for (let i = 0; i < script.steps.length; i += 1) {
    const step = script.steps[i];
    if (!isObject(step)) {
      return { valid: false, error: `导入失败：steps[${i}] 必须为对象。` };
    }
    if (!Number.isInteger(step.step_no)) {
      return { valid: false, error: `导入失败：steps[${i}].step_no 必须为整数。` };
    }
    if (!step.action_name || typeof step.action_name !== "string") {
      return { valid: false, error: `导入失败：steps[${i}].action_name 必填。` };
    }
    if (!["timed", "reps"].includes(step.action_type)) {
      return { valid: false, error: `导入失败：steps[${i}].action_type 仅支持 timed/reps。` };
    }
    if (!Number.isInteger(step.sets) || step.sets <= 0) {
      return { valid: false, error: `导入失败：steps[${i}].sets 必须为正整数。` };
    }
  }

  return { valid: true, error: "" };
}

export function parseAndValidateSessionScript(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (_e) {
    return { valid: false, error: "导入失败：JSON 格式错误，请检查逗号和引号。", script: null };
  }

  const result = validateSessionScript(parsed);
  return {
    valid: result.valid,
    error: result.error,
    script: result.valid ? parsed : null
  };
}
