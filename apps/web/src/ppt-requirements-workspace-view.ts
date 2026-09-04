import type { PptFixedRequirements } from "@selfalone/contracts";
import { escapeHtml } from "./ui/desktop-shell";
import type { PptRequirementsWorkspaceState } from "./ppt-requirements-workspace-state";

const pagePresets = [[6, 8], [8, 10], [10, 12]] as const;

function presetValue(range: PptFixedRequirements["pageRange"]) {
  if (!range) return "8-10";
  return pagePresets.some(([min, max]) => min === range.min && max === range.max)
    ? `${range.min}-${range.max}`
    : "custom";
}

export function renderPptRequirementsWorkspaceView(state: PptRequirementsWorkspaceState) {
  if (state.phase !== "ready") return "";
  const requirements = state.workspace.draft.requirements;
  const source = state.workspace.sources[0];
  const range = requirements.pageRange ?? { min: 8, max: 10 };
  const preset = presetValue(requirements.pageRange);

  return `<section class="desktop-task-panel-inner ppt-requirements-workspace" data-current-stage="requirements" data-stage-title="范围与需求" aria-labelledby="ppt-requirements-title">
    <header class="desktop-task-header"><p>当前任务</p><h2 id="ppt-requirements-title">范围与需求</h2></header>
    <ol class="desktop-stage-steps" aria-label="PPT 生成进度">
      <li class="active" aria-current="step"><span aria-hidden="true">1</span><strong>范围与需求</strong></li>
      <li class=""><span aria-hidden="true">2</span><strong>大纲</strong></li>
      <li class=""><span aria-hidden="true">3</span><strong>模板</strong></li>
      <li class=""><span aria-hidden="true">4</span><strong>生成</strong></li>
    </ol>
    <div class="desktop-task-body">
      <p class="ppt-requirements-source">来源：${escapeHtml(source.title)}${source.author ? ` · ${escapeHtml(source.author)}` : ""}</p>
      <form class="ppt-requirements-form" data-ppt-requirements-form>
      <label>用途
        <input name="purpose" list="ppt-purpose-options" maxlength="120" value="${escapeHtml(requirements.purpose ?? "")}" aria-describedby="ppt-purpose-help" placeholder="例如：读书分享" />
        <span id="ppt-purpose-help" class="ppt-requirements-field-help">可从常用用途中选择，也可直接输入自定义用途。</span>
      </label>
      <datalist id="ppt-purpose-options">
        <option value="读书分享"></option>
        <option value="课程讲解"></option>
        <option value="工作汇报"></option>
      </datalist>
      <label>受众
        <input name="audience" list="ppt-audience-options" maxlength="120" value="${escapeHtml(requirements.audience ?? "")}" aria-describedby="ppt-audience-help" placeholder="例如：产品团队" />
        <span id="ppt-audience-help" class="ppt-requirements-field-help">可从常用受众中选择，也可直接输入自定义受众。</span>
      </label>
      <datalist id="ppt-audience-options">
        <option value="同事"></option>
        <option value="学生"></option>
        <option value="读书会成员"></option>
      </datalist>
      <fieldset><legend>页数范围</legend>
        <label class="ppt-requirements-preset"><span>常用范围</span><select name="pagePreset" data-ppt-page-preset>
          <option value="6-8"${preset === "6-8" ? " selected" : ""}>6–8 页</option>
          <option value="8-10"${preset === "8-10" ? " selected" : ""}>8–10 页</option>
          <option value="10-12"${preset === "10-12" ? " selected" : ""}>10–12 页</option>
          <option value="custom"${preset === "custom" ? " selected" : ""}>自定义</option>
        </select></label>
        <div class="ppt-requirements-range"><label>最少<input name="pageMin" data-ppt-page-min type="number" min="1" max="2147483647" value="${range.min}" /></label><span aria-hidden="true">—</span><label>最多<input name="pageMax" data-ppt-page-max type="number" min="1" max="2147483647" value="${range.max}" /></label></div>
      </fieldset>
      <label>补充要求<textarea name="additionalRequirements" maxlength="2000" rows="5" placeholder="例如：保留关键案例，整体简洁">${escapeHtml(requirements.additionalRequirements)}</textarea></label>
      </form>
    </div>
  </section>`;
}

export function renderPptRequirementsWorkspaceNotice(state: PptRequirementsWorkspaceState) {
  if (state.phase === "pending") return `<p class="ppt-requirements-notice" role="status">正在准备这本书的 PPT 范围与需求…</p>`;
  if (state.phase === "error") return `<p class="ppt-requirements-notice ppt-requirements-notice-error" role="alert">PPT 工作区暂时无法准备。<button type="button" data-ppt-workspace-retry>重试</button></p>`;
  return "";
}
