# 训练计时器 MVP + 数据记录后台（本地版）

一个可本地运行的训练计时器 MVP，包含：
- Session Script 加载
- 训练执行（timed + reps 最小流程）
- 训练事件日志记录（9 个 event_code）
- 训练后反馈
- Session Result / Event Logs JSON 导出
- localStorage 本地持久化（最近一次训练）

## 1. 运行方式

本项目采用无依赖静态网页实现（便于快速跑通 MVP）。

```bash
cd app
python3 -m http.server 5173
```

打开浏览器访问：
- `http://localhost:5173`

## 2. 页面说明

1. **Session 加载/开始页**
   - 默认加载示例 `sample_session_script.json`
   - 支持文件选择导入（`.json`）
   - 支持文本粘贴导入（textarea）
   - 导入后进行基础校验（JSON 格式 + session_id/session_name/total_steps/steps）
   - 展示 Session 概要并开始训练

2. **训练执行页（触控优先）**
   - iPad 友好布局：大卡片、大字号、清晰分区
   - 优先突出：当前动作、组数、动作要求、倒计时
   - 支持按钮：
     - 暂停（pause）/继续（resume）
     - 跳过（skip）
     - 休息（rest_start，默认 60 秒）
     - +60 秒（rest_extend）
     - 完成当前组（reps动作）
     - **重新开始**（重置本次未提交训练进度与临时事件）
     - 结束训练（end_session）

3. **训练后反馈与导出页**
   - 整体难度：太简单/刚好/太难
   - 疲劳评分：1-10
   - 疼痛/不适位置：可选文本
   - 如果本次发生 skip 或 end_session，则显示对应原因输入
   - 导出：`Session Result JSON` / `Event Logs JSON`

## 3. 数据契约

### 3.1 输入：Session Script
- 文件：`app/data/sample_session_script.json`
- 字段：
  - `session_id`, `session_name`, `total_steps`, `steps[]`
  - 每个 step 含：
    - `step_no`, `action_name`, `action_type`
    - `target_reps` 或 `target_seconds`
    - `sets`, `rest_seconds`, `safety_tip`, `alternative_action`, `rep_mode`, `phase`

### 3.2 输出：Session Result
字段如下：
- `session_id`, `session_name`
- `start_time`, `end_time`, `duration_seconds`
- `planned_steps`, `completed_steps`
- `planned_sets`, `completed_sets`
- `ended_early`, `ended_on_step_no`, `ended_on_action_name`
- `overall_difficulty`, `fatigue_score`, `discomfort_notes`

### 3.3 输出：Event Logs
每条事件字段：
- `event_id`, `session_id`, `event_code`, `timestamp`
- `step_no`, `action_name`, `payload`

> 备注：事件字典文档中的 `ts` 在本实现中映射为 `timestamp`（ISO8601）。

## 4. event_code 与事件字典映射

仅使用以下 9 个事件码：
- `pause`
- `resume`
- `skip`
- `rest_start`
- `rest_extend`
- `rest_end`
- `end_session`
- `session_complete`
- `post_feedback_submit`

事件码常量定义：`app/models/events.js`

## 5. 示例文件（交付物）

- 示例 Session Script：`examples/sample_session_script.json`
- 示例 Session Result：`examples/sample_session_result.json`
- 示例 Event Logs：`examples/sample_event_logs.json`

## 6. 本地验证建议

1. 在加载页使用“文件导入”或“文本粘贴导入”加载自定义 Session Script，校验通过后确认 Session 信息（名称/step/计划组数）已更新
2. 正常完整训练至结束，确认 `session_complete`
3. 训练中点击暂停/继续，确认 `pause` / `resume`
4. 点击跳过，确认 `skip`，并在反馈页补填原因
5. 点击休息后再 +60，确认 `rest_start` / `rest_extend` / `rest_end`
6. 点击结束训练，确认 `end_session` 且 Session Result 中 `ended_early=true`
7. 在训练执行页点击“重新开始”，确认回到第一步第一组，且无需重新导入 Session
8. 提交反馈，确认 `post_feedback_submit`
