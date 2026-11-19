/**
 * node_filter.js
 * 节点过滤规则引擎与配置弹窗（支持保留正则、排除正则及实时匹配预览）。
 */

import { escapeHtml, showToast, openConfirmModal } from "./utils.js";
import { getStoredAirports, saveStoredAirports } from "./store.js";
import { t, onLanguageChange } from "./i18n/i18n.js";

/**
 * 默认预设规则库初始种子数据。
 */
export const FILTER_PRESET_LIBRARY = [
    {
        id: "builtin_clean_ads",
        name: "🧹 Remove Invalid & Ads",
        desc: "Filter out official site, expired, remaining traffic, invalid, and 0.1x rate nodes, keeping real working proxies",
        include: "",
        exclude: "(失效|重新复制|到期|剩余|官网|通知|公告|网站|群|客服|回国|中国|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_ai_dedicated",
        name: "🤖 AI / LLM Dedicated",
        desc: "Keep major regions supporting OpenAI, Claude, and Gemini (US, JP, SG, TW, UK), auto-excluding HK and invalid nodes",
        include: "(美|US|United States|日|JP|Japan|新|SG|Singapore|台湾|TW|韩|KR|英|UK|Claude|OpenAI)",
        exclude: "(香港|HK|Hong Kong|0\\.1x|失效|官网|剩余|到期|公告)",
        isBuiltin: true
    },
    {
        id: "builtin_east_asia",
        name: "🌏 East Asia Low Latency",
        desc: "Optimize for HK, JP, SG, KR, TW and nearby low-latency nodes",
        include: "(香港|HK|日本|JP|新加坡|SG|韩国|KR|台湾|TW)",
        exclude: "(失效|官网|剩余|到期|公告|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_hk_only",
        name: "🇭🇰 Hong Kong Only",
        desc: "Keep Hong Kong nodes only (including HKT, BGP, IPLC, etc.)",
        include: "(香港|HK|Hong Kong|🇭🇰)",
        exclude: "(失效|官网|剩余|到期|公告|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_jp_only",
        name: "🇯🇵 Japan Only",
        desc: "Keep Japan nodes only (Tokyo, Osaka, etc.)",
        include: "(日本|JP|Japan|东京|大阪|🇯🇵)",
        exclude: "(失效|官网|剩余|到期|公告|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_us_only",
        name: "🇺🇸 United States Only",
        desc: "Keep US mainland nodes only (LA, San Jose, Portland, New York, Phoenix, etc.)",
        include: "(美国|US|United States|美|洛杉矶|硅谷|纽约|凤凰城|🇺🇸)",
        exclude: "(失效|官网|剩余|到期|公告|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_sg_only",
        name: "🇸🇬 Singapore Only",
        desc: "Keep Singapore nodes only",
        include: "(新加坡|SG|Singapore|狮城|🇸🇬)",
        exclude: "(失效|官网|剩余|到期|公告|0\\.1x)",
        isBuiltin: true
    },
    {
        id: "builtin_streaming_unlock",
        name: "⚡ Streaming & Unlock",
        desc: "Optimize for native IP, streaming unlock (Netflix, Disney, YouTube) and AI unlock nodes",
        include: "(原生|解锁|流媒体|NF|Disney|YouTube|AI|GPT|ChatGPT)",
        exclude: "(失效|官网|剩余|到期|公告)",
        isBuiltin: true
    },
    {
        id: "builtin_direct_iplc",
        name: "🚀 IPLC & Dedicated",
        desc: "Optimize for IPLC, IEPL, BGP dedicated intranet nodes",
        include: "(专线|IPLC|IEPL|BGP|AIA)",
        exclude: "(0\\.1x|0\\.01x|失效|官网|剩余|到期)",
        isBuiltin: true
    },
    {
        id: "builtin_low_rate",
        name: "⚡ 1x & Lower Multiplier",
        desc: "Keep 1x, 0.5x, 0.1x low-multiplier nodes, auto-excluding high-multiplier nodes (2x, 3x, 5x, etc.)",
        include: "",
        exclude: "([2-9]x|[1-9][0-9]x|高倍|2倍|3倍|5倍)",
        isBuiltin: true
    }
];

const STORAGE_KEY_RULE_LIBRARY = "nodepilot_filter_rule_library";

/**
 * 读取本地持久化存储的过滤规则库。
 * @returns {Array} 规则对象数组
 */
export function getStoredRuleLibrary() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_RULE_LIBRARY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list) && list.length > 0) {
                return list;
            }
        }
    } catch (e) {
        console.warn("Error reading filter rule library cache:", e);
    }
    // 使用内置预设种子进行初始化
    return FILTER_PRESET_LIBRARY.map(item => ({ ...item }));
}

/**
 * 持久化保存规则库至 localStorage 及后端 SQLite 数据库。
 * @param {Array} list - 规则对象列表
 */
export function saveStoredRuleLibrary(list) {
    try {
        localStorage.setItem(STORAGE_KEY_RULE_LIBRARY, JSON.stringify(list || []));
    } catch (e) {
        console.warn("Error saving filter rule library cache:", e);
    }
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveRuleLibraryJSON) {
        window.go.main.App.SaveRuleLibraryJSON(JSON.stringify(list || [])).catch(e => {
            console.error("Error saving rule library to SQLite:", e);
        });
    }
}

let currentFilteringAirport = null;
let onFilterSavedCallback = null;
let closeTimer = null;

/**
 * 依据包含正则 (include) 与排除正则 (exclude) 过滤原始节点列表。
 * @param {Array} rawNodes - 原始全量节点列表
 * @param {Object} rules - 规则配置对象 { include, exclude, caseInsensitive }
 * @returns {Array} 过滤保留后的目标节点列表
 */
export function applyNodeFilters(rawNodes = [], rules = {}) {
    if (!Array.isArray(rawNodes) || rawNodes.length === 0) return [];
    if (!rules) return rawNodes.slice();

    const includePattern = (rules.include || "").trim();
    const excludePattern = (rules.exclude || "").trim();
    const flags = rules.caseInsensitive !== false ? "i" : "";

    let includeRegex = null;
    let excludeRegex = null;

    if (includePattern) {
        try {
            includeRegex = new RegExp(includePattern, flags);
        } catch (e) {
            console.warn("Include regex compilation error:", e);
        }
    }

    if (excludePattern) {
        try {
            excludeRegex = new RegExp(excludePattern, flags);
        } catch (e) {
            console.warn("Exclude regex compilation error:", e);
        }
    }

    // 若未配置任何有效正则规则，直接返回原始副本
    if (!includeRegex && !excludeRegex) {
        return rawNodes.slice();
    }

    return rawNodes.filter(node => {
        const text = `${node.name || ""} ${node.server || ""} ${node.type || ""}`;

        // 1. 正向保留过滤：若配置了包含正则且未命中，则剔除
        if (includeRegex && !includeRegex.test(text)) {
            return false;
        }

        // 2. 反向排除过滤：若配置了排除正则且命中，则剔除
        if (excludeRegex && excludeRegex.test(text)) {
            return false;
        }

        return true;
    });
}

/**
 * 初始化节点过滤模态抽屉的各交互事件监听器。
 * @param {Function} onFilterSaved - 过滤规则保存成功后的业务回调函数
 */
export function initNodeFilterModal(onFilterSaved) {
    onFilterSavedCallback = onFilterSaved;

    const modal = document.getElementById("modal-node-filter");
    const backdrop = document.getElementById("filter-backdrop");
    const btnClose = document.getElementById("filter-modal-close");
    const btnCancel = document.getElementById("filter-btn-cancel");
    const btnReset = document.getElementById("filter-btn-reset");
    const btnSave = document.getElementById("filter-btn-save");

    const inputInclude = document.getElementById("filter-include-input");
    const inputExclude = document.getElementById("filter-exclude-input");
    const checkCase = document.getElementById("filter-case-insensitive");

    // 左侧规则预设库面板元素
    const panelLibrary = document.getElementById("filter-library-panel");
    const btnLibraryToggle = document.getElementById("filter-btn-library-toggle");
    const btnLibraryClose = document.getElementById("filter-library-btn-close");
    const inputLibrarySearch = document.getElementById("filter-library-search");
    const btnLibraryAdd = document.getElementById("filter-library-btn-add");
    const btnLibrarySaveCurrent = document.getElementById("filter-library-btn-save-current");
    const btnLibraryResetDefault = document.getElementById("filter-library-btn-reset-default");

    // 规则库内联表单编辑元素
    const formBox = document.getElementById("filter-library-form-box");
    const formTitle = document.getElementById("filter-library-form-title");
    const formId = document.getElementById("filter-form-rule-id");
    const formName = document.getElementById("filter-form-name");
    const formInclude = document.getElementById("filter-form-include");
    const formExclude = document.getElementById("filter-form-exclude");
    const formDesc = document.getElementById("filter-form-desc");
    const formBtnCancel = document.getElementById("filter-form-btn-cancel");
    const formBtnSave = document.getElementById("filter-form-btn-save");

    if (btnClose) btnClose.addEventListener("click", closeNodeFilterModal);
    if (btnCancel) btnCancel.addEventListener("click", closeNodeFilterModal);
    if (backdrop) backdrop.addEventListener("click", closeNodeFilterModal);

    // ESC 按键监听：关闭抽屉与规则库面板返回工作区
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && currentFilteringAirport) {
            closeNodeFilterModal();
        }
    });

    // 规则库展开/收起切换按钮
    if (btnLibraryToggle && panelLibrary) {
        btnLibraryToggle.addEventListener("click", () => {
            const isOpen = panelLibrary.classList.contains("panel-open");
            if (isOpen) {
                closeRuleLibraryPanel();
            } else {
                openRuleLibraryPanel();
            }
        });
    }

    if (btnLibraryClose) {
        btnLibraryClose.addEventListener("click", closeRuleLibraryPanel);
    }

    // 搜索规则库
    if (inputLibrarySearch) {
        inputLibrarySearch.addEventListener("input", () => {
            renderRuleLibraryList(inputLibrarySearch.value);
            syncPresetActiveState(inputInclude ? inputInclude.value : "", inputExclude ? inputExclude.value : "");
        });
    }

    // 新建自定义规则按钮
    if (btnLibraryAdd && formBox) {
        btnLibraryAdd.addEventListener("click", () => {
            openRuleForm({
                id: "",
                name: "",
                include: "",
                exclude: "",
                desc: "",
                title: t("filter.form_add_title", {}, "✨ Add Custom Rule")
            });
        });
    }

    // 将当前输入框中的正则保存为新规则
    if (btnLibrarySaveCurrent && formBox) {
        btnLibrarySaveCurrent.addEventListener("click", () => {
            const inc = inputInclude ? inputInclude.value.trim() : "";
            const exc = inputExclude ? inputExclude.value.trim() : "";
            if (!inc && !exc) {
                showToast(t("filter.toast_no_regex_input", {}, "No include or exclude regex entered"));
                return;
            }
            openRuleForm({
                id: "",
                name: "",
                include: inc,
                exclude: exc,
                desc: t("filter.desc_saved_from_input", {}, "Rule saved from current input fields"),
                title: t("filter.form_save_current_title", {}, "💾 Save Current Rule to Library")
            });
        });
    }

    // 取消表单编辑
    if (formBtnCancel && formBox) {
        formBtnCancel.addEventListener("click", () => {
            formBox.classList.add("hidden");
        });
    }

    // 保存规则表单（新增或修改更新）
    if (formBtnSave) {
        formBtnSave.addEventListener("click", () => {
            const name = (formName ? formName.value : "").trim();
            const includeVal = (formInclude ? formInclude.value : "").trim();
            const excludeVal = (formExclude ? formExclude.value : "").trim();
            const desc = (formDesc ? formDesc.value : "").trim();
            const ruleId = formId ? formId.value : "";

            if (!name) {
                alert(t("filter.alert_empty_name", {}, "Please enter a rule name"));
                if (formName) formName.focus();
                return;
            }

            // 校验正则表达式语法有效性
            if (includeVal) {
                try {
                    new RegExp(includeVal);
                } catch (e) {
                    alert(t("filter.err_inc_syntax", { error: e.message }, "Include regex syntax error: " + e.message));
                    return;
                }
            }
            if (excludeVal) {
                try {
                    new RegExp(excludeVal);
                } catch (e) {
                    alert(t("filter.err_exc_syntax", { error: e.message }, "Exclude regex syntax error: " + e.message));
                    return;
                }
            }

            const library = getStoredRuleLibrary();
            if (ruleId) {
                // 编辑更新已有规则
                const target = library.find(r => r.id === ruleId);
                if (target) {
                    target.name = name;
                    target.include = includeVal;
                    target.exclude = excludeVal;
                    target.desc = desc;
                }
                showToast(t("filter.toast_updated_rule", { name }, `✅ Rule updated: "${name}"`));
            } else {
                // 新增自定义规则
                library.unshift({
                    id: "custom_" + Date.now(),
                    name: name,
                    include: includeVal,
                    exclude: excludeVal,
                    desc: desc,
                    isBuiltin: false
                });
                showToast(t("filter.toast_added_rule", { name }, `✅ Rule added: "${name}"`));
            }

            saveStoredRuleLibrary(library);
            if (formBox) formBox.classList.add("hidden");
            renderRuleLibraryList(inputLibrarySearch ? inputLibrarySearch.value : "");
            syncPresetActiveState(inputInclude ? inputInclude.value : "", inputExclude ? inputExclude.value : "");
        });
    }

    // 恢复内置默认规则库预设
    if (btnLibraryResetDefault) {
        btnLibraryResetDefault.addEventListener("click", () => {
            openConfirmModal(
                t("filter.confirm_reset_title", {}, "🔄 Restore Default Presets"),
                t("filter.confirm_reset_content", {}, "Restore default preset rules library? Custom rules will be preserved."),
                () => {
                    const defaultList = FILTER_PRESET_LIBRARY.map(item => ({ ...item }));
                    saveStoredRuleLibrary(defaultList);
                    if (inputLibrarySearch) inputLibrarySearch.value = "";
                    renderRuleLibraryList();
                    syncPresetActiveState(inputInclude ? inputInclude.value : "", inputExclude ? inputExclude.value : "");
                    showToast(t("filter.toast_reset_default", {}, "✅ Restored default preset rules library"));
                }
            );
        });
    }

    // 键入正则时实时刷新节点匹配预览并同步高亮激活的预设项
    if (inputInclude) {
        inputInclude.addEventListener("input", () => {
            syncPresetActiveState(inputInclude.value, inputExclude ? inputExclude.value : "");
            updateFilterPreview();
        });
    }
    if (inputExclude) {
        inputExclude.addEventListener("input", () => {
            syncPresetActiveState(inputInclude ? inputInclude.value : "", inputExclude.value);
            updateFilterPreview();
        });
    }
    if (checkCase) checkCase.addEventListener("change", updateFilterPreview);

    // 一键清空规则（带二次确认弹窗）
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            const hasInclude = inputInclude && inputInclude.value.trim().length > 0;
            const hasExclude = inputExclude && inputExclude.value.trim().length > 0;
            if (!hasInclude && !hasExclude) {
                showToast(t("filter.toast_cleared", {}, "Filter rules are already empty"));
                return;
            }

            openConfirmModal(
                t("filter.confirm_clear_title", {}, "🗑️ Clear Filter Rules Confirmation"),
                t("filter.confirm_clear_content", {}, "Clear positive include and negative exclude regex rules for current airport? All nodes will be restored."),
                () => {
                    if (inputInclude) inputInclude.value = "";
                    if (inputExclude) inputExclude.value = "";
                    syncPresetActiveState("", "");
                    updateFilterPreview();
                    showToast(t("filter.toast_cleared", {}, "Filter rules cleared"));
                    if (inputInclude) inputInclude.focus();
                }
            );
        });
    }

    // 保存并持久化过滤规则
    if (btnSave) {
        btnSave.addEventListener("click", () => {
            if (!currentFilteringAirport) return;

            const includeVal = (inputInclude.value || "").trim();
            const excludeVal = (inputExclude.value || "").trim();
            const caseInsensitive = checkCase ? checkCase.checked : true;

            // 正则语法有效性校验
            if (includeVal) {
                try {
                    new RegExp(includeVal);
                } catch (e) {
                    alert(t("filter.err_inc_syntax", { error: e.message }, "Include regex syntax error: " + e.message));
                    return;
                }
            }

            if (excludeVal) {
                try {
                    new RegExp(excludeVal);
                } catch (e) {
                    alert(t("filter.err_exc_syntax", { error: e.message }, "Exclude regex syntax error: " + e.message));
                    return;
                }
            }

            const airports = getStoredAirports();
            const target = airports.find(a => a.id === currentFilteringAirport.id);
            if (!target) return;

            const rules = {
                include: includeVal,
                exclude: excludeVal,
                caseInsensitive: caseInsensitive
            };

            target.filterRules = rules;

            // 确保原始 rawNodes 集合存在
            if (!Array.isArray(target.rawNodes) || target.rawNodes.length === 0) {
                target.rawNodes = Array.isArray(target.nodes) ? target.nodes.slice() : [];
            }

            // 执行过滤运算并更新有效节点列表
            const filteredNodes = applyNodeFilters(target.rawNodes, rules);
            target.nodes = filteredNodes;
            target.nodeCount = filteredNodes.length;
            target.totalNodeCount = target.rawNodes.length;

            saveStoredAirports(airports);
            closeNodeFilterModal();

            showToast(t("filter.toast_filter_applied", { name: target.name, kept: target.nodeCount, total: target.totalNodeCount }, `✅ Filter applied for "${target.name}" (Kept ${target.nodeCount}/${target.totalNodeCount} nodes)`));

            if (typeof onFilterSavedCallback === "function") {
                onFilterSavedCallback();
            }
        });
    }
}

/**
 * 展开左侧规则库侧滑面板。
 */
export function openRuleLibraryPanel() {
    const panel = document.getElementById("filter-library-panel");
    const btnToggle = document.getElementById("filter-btn-library-toggle");
    const inputInclude = document.getElementById("filter-include-input");
    const inputExclude = document.getElementById("filter-exclude-input");

    if (panel) {
        panel.classList.add("panel-open");
    }
    if (btnToggle) {
        btnToggle.classList.add("active");
    }

    renderRuleLibraryList();
    syncPresetActiveState(inputInclude ? inputInclude.value : "", inputExclude ? inputExclude.value : "");
}

/**
 * 收起左侧规则库侧滑面板。
 */
export function closeRuleLibraryPanel() {
    const panel = document.getElementById("filter-library-panel");
    const btnToggle = document.getElementById("filter-btn-library-toggle");
    const formBox = document.getElementById("filter-library-form-box");

    if (panel) {
        panel.classList.remove("panel-open");
    }
    if (btnToggle) {
        btnToggle.classList.remove("active");
    }
    if (formBox) {
        formBox.classList.add("hidden");
    }
}

/**
 * 打开内联规则新增/编辑表单。
 */
function openRuleForm({ id = "", name = "", include = "", exclude = "", desc = "", title = "" }) {
    const formBox = document.getElementById("filter-library-form-box");
    const formTitle = document.getElementById("filter-library-form-title");
    const formId = document.getElementById("filter-form-rule-id");
    const formName = document.getElementById("filter-form-name");
    const formInclude = document.getElementById("filter-form-include");
    const formExclude = document.getElementById("filter-form-exclude");
    const formDesc = document.getElementById("filter-form-desc");

    if (!formBox) return;

    if (formTitle) formTitle.innerText = title || t("filter.form_edit_title", {}, "✏️ Edit Rule");
    if (formId) formId.value = id;
    if (formName) formName.value = name;
    if (formInclude) formInclude.value = include;
    if (formExclude) formExclude.value = exclude;
    if (formDesc) formDesc.value = desc;

    formBox.classList.remove("hidden");
    if (formName) formName.focus();
}

/**
 * 渲染左侧规则库卡片列表。
 * @param {string} filterText - 模糊搜索关键字
 */
export function renderRuleLibraryList(filterText = "") {
    const listEl = document.getElementById("filter-library-list");
    const countEl = document.getElementById("filter-library-count");
    if (!listEl) return;

    const allRules = getStoredRuleLibrary();
    const query = (filterText || "").trim().toLowerCase();

    const filteredRules = query ? allRules.filter(r => {
        const str = `${r.name || ""} ${r.desc || ""} ${r.include || ""} ${r.exclude || ""}`.toLowerCase();
        return str.includes(query);
    }) : allRules;

    if (countEl) {
        countEl.innerText = `${filteredRules.length} ${t("filter.rule_count_suffix", {}, "items")}`;
    }

    if (filteredRules.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 24px 12px; font-size: 0.8rem;">
                ${t("filter.empty_search", {}, "No matching rules found")}<br/>
                <button id="filter-library-empty-add-btn" class="btn btn-secondary btn-xs" style="margin-top: 10px;">
                    ＋ ${t("filter.create_rule_now", { query: escapeHtml(query) }, `Create "${escapeHtml(query)}" now`)}
                </button>
            </div>
        `;
        const emptyBtn = document.getElementById("filter-library-empty-add-btn");
        if (emptyBtn) {
            emptyBtn.addEventListener("click", () => {
                openRuleForm({
                    id: "",
                    name: query,
                    include: "",
                    exclude: "",
                    desc: "",
                    title: t("filter.form_add_title", {}, "✨ Add Custom Rule")
                });
            });
        }
        return;
    }

    listEl.innerHTML = filteredRules.map(rule => {
        const isBuiltin = !!rule.isBuiltin;
        const displayName = isBuiltin ? t(`filter.presets.${rule.id}.name`, {}, rule.name) : rule.name;
        const displayDesc = isBuiltin ? t(`filter.presets.${rule.id}.desc`, {}, rule.desc) : rule.desc;
        const tagText = isBuiltin ? t("filter.tag_builtin", {}, "Preset") : t("filter.tag_custom", {}, "Custom");
        const incText = rule.include || t("filter.unlimited", {}, "(All)");
        const excText = rule.exclude || t("filter.no_exclude", {}, "(None)");
        return `
            <div class="filter-library-item" data-rule-id="${rule.id}">
                <div class="filter-item-head">
                    <div class="filter-item-name" title="${escapeHtml(displayName)}">
                        <span>${escapeHtml(displayName)}</span>
                        <span class="filter-item-tag">${tagText}</span>
                    </div>
                    <div class="filter-item-actions">
                        <button class="filter-item-btn btn-rule-apply" data-rule-id="${rule.id}" title="${t("filter.btn_apply_title", {}, "Apply this rule to inputs")}">
                            ✔ ${t("filter.btn_apply", {}, "Apply")}
                        </button>
                        <button class="filter-item-btn btn-rule-edit" data-rule-id="${rule.id}" title="${t("filter.btn_edit_title", {}, "Edit this rule")}">
                            ✏️
                        </button>
                        <button class="filter-item-btn btn-del btn-rule-delete" data-rule-id="${rule.id}" title="${t("filter.btn_delete_title", {}, "Delete this rule")}">
                            🗑️
                        </button>
                    </div>
                </div>
                ${displayDesc ? `<div class="filter-item-desc">${escapeHtml(displayDesc)}</div>` : ""}
                <div class="filter-item-regex-summary">
                    <div class="filter-item-regex-row" title="${t("filter.label_inc_short", {}, "Include:")} ${escapeHtml(incText)}">
                        <span style="color: var(--accent-green); font-weight: 600;">🟢 ${t("filter.label_inc_short", {}, "Include:")}</span>
                        <span style="color: var(--text-primary);">${escapeHtml(incText)}</span>
                    </div>
                    <div class="filter-item-regex-row" title="${t("filter.label_exc_short", {}, "Exclude:")} ${escapeHtml(excText)}">
                        <span style="color: var(--accent-red); font-weight: 600;">🔴 ${t("filter.label_exc_short", {}, "Exclude:")}</span>
                        <span style="color: var(--text-primary);">${escapeHtml(excText)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    // 绑定规则应用、编辑与删除按钮事件
    listEl.querySelectorAll(".filter-library-item").forEach(card => {
        const ruleId = card.getAttribute("data-rule-id");
        const rule = allRules.find(r => r.id === ruleId);
        if (!rule) return;

        // 点击规则卡片主体直接应用规则
        card.addEventListener("click", (e) => {
            if (e.target.closest(".filter-item-btn")) return;
            applyRuleToFilter(rule);
        });

        // 应用按钮
        const btnApply = card.querySelector(".btn-rule-apply");
        if (btnApply) {
            btnApply.addEventListener("click", (e) => {
                e.stopPropagation();
                applyRuleToFilter(rule);
            });
        }

        // 编辑按钮
        const btnEdit = card.querySelector(".btn-rule-edit");
        if (btnEdit) {
            btnEdit.addEventListener("click", (e) => {
                e.stopPropagation();
                const isBuiltin = !!rule.isBuiltin;
                const rName = isBuiltin ? t(`filter.presets.${rule.id}.name`, {}, rule.name) : rule.name;
                const rDesc = isBuiltin ? t(`filter.presets.${rule.id}.desc`, {}, rule.desc) : rule.desc;
                openRuleForm({
                    id: rule.id,
                    name: rName,
                    include: rule.include || "",
                    exclude: rule.exclude || "",
                    desc: rDesc || "",
                    title: t("filter.form_edit_title_named", { name: rName }, `✏️ Edit Rule "${rName}"`)
                });
            });
        }

        // 删除按钮
        const btnDel = card.querySelector(".btn-rule-delete");
        if (btnDel) {
            btnDel.addEventListener("click", (e) => {
                e.stopPropagation();
                const isBuiltin = !!rule.isBuiltin;
                const rName = isBuiltin ? t(`filter.presets.${rule.id}.name`, {}, rule.name) : rule.name;
                openConfirmModal(
                    t("filter.confirm_delete_title", {}, "🗑️ Delete Rule Confirmation"),
                    t("filter.confirm_delete_content", { name: escapeHtml(rName) }, `Delete "${escapeHtml(rName)}" from rule library? This cannot be undone.`),
                    () => {
                        const curList = getStoredRuleLibrary();
                        const nextList = curList.filter(r => r.id !== rule.id);
                        saveStoredRuleLibrary(nextList);
                        renderRuleLibraryList(document.getElementById("filter-library-search")?.value || "");
                        showToast(t("filter.toast_deleted_rule", { name: rName }, `Deleted rule: "${rName}"`));
                    }
                );
            });
        }
    });
}

/**
 * 将选中的规则载入右侧输入框并即时计算匹配预览。
 * @param {Object} rule - 目标规则对象
 */
function applyRuleToFilter(rule) {
    if (!rule) return;

    const inputInclude = document.getElementById("filter-include-input");
    const inputExclude = document.getElementById("filter-exclude-input");
    const checkCase = document.getElementById("filter-case-insensitive");

    if (inputInclude) inputInclude.value = rule.include || "";
    if (inputExclude) inputExclude.value = rule.exclude || "";
    if (checkCase) checkCase.checked = true;

    syncPresetActiveState(rule.include || "", rule.exclude || "");
    updateFilterPreview();
    const rName = rule.isBuiltin ? t(`filter.presets.${rule.id}.name`, {}, rule.name) : rule.name;
    showToast(t("filter.toast_applied_rule", { name: rName }, `Rule applied: "${rName}"`));
}

/**
 * 依据当前输入框中的正则表达式高亮匹配的规则卡片。
 * @param {string} includeVal - 包含正则字符串
 * @param {string} excludeVal - 排除正则字符串
 */
export function syncPresetActiveState(includeVal, excludeVal) {
    const listEl = document.getElementById("filter-library-list");
    if (!listEl) return;
    const cleanInc = (includeVal || "").trim();
    const cleanExc = (excludeVal || "").trim();

    const library = getStoredRuleLibrary();

    listEl.querySelectorAll(".filter-library-item").forEach(card => {
        const rid = card.getAttribute("data-rule-id");
        const rule = library.find(r => r.id === rid);
        if (rule && (rule.include || "").trim() === cleanInc && (rule.exclude || "").trim() === cleanExc) {
            card.classList.add("active");
        } else {
            card.classList.remove("active");
        }
    });
}

/**
 * 展开右侧滑出抽屉并加载目标机场的过滤规则配置。
 * @param {Object} airport - 目标机场数据对象
 */
export function openNodeFilterModal(airport) {
    if (!airport) return;
    currentFilteringAirport = airport;

    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    const modal = document.getElementById("modal-node-filter");
    const title = document.getElementById("filter-modal-title");
    const inputInclude = document.getElementById("filter-include-input");
    const inputExclude = document.getElementById("filter-exclude-input");
    const checkCase = document.getElementById("filter-case-insensitive");

    if (title) {
        title.innerHTML = t("filter.modal_title_airport", { name: escapeHtml(airport.name) }, `🎯 Node Filter Rules - Airport 「${escapeHtml(airport.name)}」`);
    }

    const rules = airport.filterRules || {};
    if (inputInclude) inputInclude.value = rules.include || "";
    if (inputExclude) inputExclude.value = rules.exclude || "";
    if (checkCase) checkCase.checked = rules.caseInsensitive !== false;

    // 默认收起左侧规则库抽屉面板
    closeRuleLibraryPanel();

    updateFilterPreview();

    if (modal) {
        modal.classList.remove("hidden");
        requestAnimationFrame(() => {
            modal.classList.add("drawer-open");
        });
    }
    if (inputInclude) inputInclude.focus();
}

/**
 * 平滑关闭右侧滑出抽屉。
 */
export function closeNodeFilterModal() {
    closeRuleLibraryPanel();

    const modal = document.getElementById("modal-node-filter");
    if (modal) {
        modal.classList.remove("drawer-open");
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            modal.classList.add("hidden");
            closeTimer = null;
        }, 280);
    }
    currentFilteringAirport = null;
}

/**
 * 实时计算并渲染过滤后节点匹配状态预览列表。
 */
function updateFilterPreview() {
    if (!currentFilteringAirport) return;

    const inputInclude = document.getElementById("filter-include-input");
    const inputExclude = document.getElementById("filter-exclude-input");
    const checkCase = document.getElementById("filter-case-insensitive");
    const countEl = document.getElementById("filter-preview-count");
    const errEl = document.getElementById("filter-error-msg");
    const listEl = document.getElementById("filter-preview-list");

    const includeVal = (inputInclude?.value || "").trim();
    const excludeVal = (inputExclude?.value || "").trim();
    const flags = (checkCase && checkCase.checked) ? "i" : "";

    let incRegex = null;
    let excRegex = null;
    let syntaxErr = "";

    if (includeVal) {
        try {
            incRegex = new RegExp(includeVal, flags);
        } catch (e) {
            syntaxErr = t("filter.err_inc_syntax", { error: e.message }, `Include regex syntax error: ${e.message}`);
        }
    }

    if (excludeVal && !syntaxErr) {
        try {
            excRegex = new RegExp(excludeVal, flags);
        } catch (e) {
            syntaxErr = t("filter.err_exc_syntax", { error: e.message }, `Exclude regex syntax error: ${e.message}`);
        }
    }

    if (errEl) {
        if (syntaxErr) {
            errEl.innerText = syntaxErr;
            errEl.classList.remove("hidden");
        } else {
            errEl.classList.add("hidden");
        }
    }

    const rawNodes = currentFilteringAirport.rawNodes || currentFilteringAirport.nodes || [];
    const totalCount = rawNodes.length;

    let keptCount = 0;
    let excludedCount = 0;

    const previewItemsHtml = [];

    rawNodes.forEach(node => {
        const text = `${node.name || ""} ${node.server || ""} ${node.type || ""}`;
        let isKept = true;
        let excludeReason = "";

        if (incRegex && !incRegex.test(text)) {
            isKept = false;
            excludeReason = t("filter.reason_not_matched", {}, "Did not match include regex");
        } else if (excRegex && excRegex.test(text)) {
            isKept = false;
            excludeReason = t("filter.reason_matched_exclude", {}, "Matched exclude regex");
        }

        if (isKept) {
            keptCount++;
            previewItemsHtml.push(`
                <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; border-radius:4px; background:rgba(16,185,129,0.08); font-size:0.75rem;">
                    <span style="color:var(--text-primary); font-weight:500;">🟢 ${escapeHtml(node.name)}</span>
                    <span style="color:var(--accent-green); font-size:0.7rem;">${t("filter.tag_kept", {}, "Kept")}</span>
                </div>
            `);
        } else {
            excludedCount++;
            previewItemsHtml.push(`
                <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; border-radius:4px; background:rgba(239,68,68,0.06); font-size:0.75rem; text-decoration:line-through; opacity:0.65;">
                    <span style="color:var(--text-muted);">🔴 ${escapeHtml(node.name)}</span>
                    <span style="color:var(--accent-red); font-size:0.7rem; text-decoration:none;">${excludeReason}</span>
                </div>
            `);
        }
    });

    if (countEl) {
        countEl.innerHTML = t("filter.preview_count", { kept: `<b style="color:var(--accent-green);">${keptCount}</b>`, total: totalCount, excluded: excludedCount }, `Kept: <b style="color:var(--accent-green);">${keptCount}</b> / Total ${totalCount} nodes (Excluded: ${excludedCount})`);
    }

    if (listEl) {
        if (previewItemsHtml.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:12px;">${t("filter.no_nodes_in_airport", {}, "No nodes available for this airport")}</div>`;
        } else {
            listEl.innerHTML = previewItemsHtml.join("");
        }
    }
}

// 注册全局语言切换动态刷新监听器
onLanguageChange(() => {
    if (document.getElementById("filter-library-panel")?.classList.contains("panel-open")) {
        renderRuleLibraryList(document.getElementById("filter-library-search")?.value || "");
    }
    if (currentFilteringAirport) {
        const title = document.getElementById("filter-modal-title");
        if (title) {
            title.innerHTML = t("filter.modal_title_airport", { name: escapeHtml(currentFilteringAirport.name) }, `🎯 Node Filter Rules - Airport 「${escapeHtml(currentFilteringAirport.name)}」`);
        }
        updateFilterPreview();
    }
});
