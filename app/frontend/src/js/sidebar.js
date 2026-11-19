/**
 * sidebar.js
 * 现代侧边栏多视图路由与全局状态控制器。
 */

import { getStoredAirports, getStoredBenchmarkResults, getStoredBenchmarkHistory, getStoredBenchmarkHistoryAsync, clearStoredBenchmarkHistoryAsync } from "./store.js";
import { initHistoryChart, renderHistoryChart } from "./history_chart.js";
import { escapeHtml, formatFullDateTime, extractMetrics, showToast } from "./utils.js";
import { t } from "./i18n/i18n.js";

let currentActiveView = "benchmark";
let onAirportRenderRequested = null;

export const PROBE_SERVICE_IDS = [
    "google-antigravity",
    "openai",
    "anthropic-claude",
    "google-gemini",
    "cursor"
];

/**
 * 获取指定 AI 探针服务的 API 密钥与模型配置。
 * @param {string} probeId - 探针服务唯一标识
 * @returns {{ key: string, model: string }} 包含 key 与 model 的配置对象
 */
export function getProbeConfig(probeId) {
    const key = localStorage.getItem(`nodepilot_probe_apikey_${probeId}`) || "";
    const model = localStorage.getItem(`nodepilot_probe_model_${probeId}`) || "";
    return { key, model };
}

/**
 * 更新探针状态徽章（已配置或缺失配置状态）。
 * @param {string} probeId - 探针服务唯一标识
 */
export function updateProbeStatusBadge(probeId) {
    const keyInput = document.getElementById(`probe-apikey-${probeId}`);
    const badge = document.getElementById(`probe-status-${probeId}`);
    if (!badge) return;
    const hasKey = keyInput && keyInput.value.trim().length > 0;
    if (hasKey) {
        badge.className = "probe-status-badge badge success";
        badge.dataset.status = "ready";
        badge.innerText = t("settings.probe_status_ready", {}, "✅ Configured");
        badge.title = t("settings.probe_status_ready_tip", {}, "✅ API Key configured, deep benchmark ready");
    } else {
        badge.className = "probe-status-badge badge warn";
        badge.dataset.status = "missing";
        badge.innerText = t("settings.probe_status_missing", {}, "⚠️ Missing Config");
        badge.title = t("settings.probe_status_missing_tip", {}, "⚠️ Missing API Key, streaming TPS/Jitter benchmark unavailable");
    }
}

/**
 * 持久化保存所有探针服务的配置设置（写入 localStorage 及 SQLite 数据库）。
 * @param {boolean} showToastMsg - 是否弹出 Toast 提示消息
 */
export function saveAllProbeSettings(showToastMsg = true) {
    const batch = {};
    let missingCount = 0;
    let configuredCount = 0;

    for (const id of PROBE_SERVICE_IDS) {
        const keyVal = document.getElementById(`probe-apikey-${id}`)?.value.trim() || "";
        const modelVal = document.getElementById(`probe-model-${id}`)?.value.trim() || "";

        localStorage.setItem(`nodepilot_probe_apikey_${id}`, keyVal);
        localStorage.setItem(`nodepilot_probe_model_${id}`, modelVal);

        batch[`nodepilot_probe_apikey_${id}`] = keyVal;
        batch[`nodepilot_probe_model_${id}`] = modelVal;
        batch[`probe_apikey_${id}`] = keyVal;
        batch[`probe_model_${id}`] = modelVal;

        if (keyVal.length > 0) {
            configuredCount++;
        } else {
            missingCount++;
        }
        updateProbeStatusBadge(id);
    }

    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAppSettingsBatch) {
        window.go.main.App.SaveAppSettingsBatch(batch).catch(e => console.error("Failed to save probe settings to SQLite:", e));
    }

    if (showToastMsg) {
        if (missingCount === 0) {
            showToast(t("settings.probe_saved_all_ready", {}, "💾 All 5 AI service probe credentials configured and saved! Full benchmark ready."));
        } else {
            showToast(t("settings.probe_saved_partial", { missing: missingCount }, `💾 Probe credentials saved! (⚠️ Notice: ${missingCount} service(s) missing API Key)`), "warning");
        }
    }
}

/**
 * 安全调用 Wails 桌面原生运行时打开外部链接，浏览器环境降级至新标签页打开。
 * @param {string} url - 目标外部 URL 链接
 */
export function openExternalURL(url) {
    if (!url) return;
    try {
        if (typeof window !== "undefined" && window.runtime && typeof window.runtime.BrowserOpenURL === "function") {
            window.runtime.BrowserOpenURL(url);
        } else if (typeof window !== "undefined" && typeof window.open === "function") {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    } catch (e) {
        console.error("Failed to open external URL:", url, e);
        try {
            if (typeof window !== "undefined" && typeof window.open === "function") {
                window.open(url, "_blank", "noopener,noreferrer");
            }
        } catch (_) {}
    }
}

/**
 * 切换侧边栏的折叠/展开状态。
 * @param {boolean|null} forceState - 强制指定折叠状态，为 null 时取反
 */
export function toggleSidebarCollapse(forceState = null) {
    const sidebar = document.getElementById("app-sidebar");
    const toggleBtn = document.getElementById("btn-toggle-sidebar");
    if (!sidebar) return;

    const isCollapsed = forceState !== null ? forceState : !sidebar.classList.contains("collapsed");
    if (isCollapsed) {
        sidebar.classList.add("collapsed");
        if (toggleBtn) toggleBtn.setAttribute("title", t("sidebar.toggle_collapse", {}, "Collapse/Expand Sidebar (Cmd/Ctrl+B)"));
    } else {
        sidebar.classList.remove("collapsed");
        if (toggleBtn) toggleBtn.setAttribute("title", t("sidebar.toggle_collapse", {}, "Collapse/Expand Sidebar (Cmd/Ctrl+B)"));
    }
    localStorage.setItem("nodepilot_sidebar_collapsed", isCollapsed ? "true" : "false");
}

/**
 * 初始化侧边栏交互监听、视图导航与参数设置双向绑定。
 * @param {Function} onAirportRender - 切换至机场视图时的渲染回调函数
 */
export function initSidebar(onAirportRender) {
    onAirportRenderRequested = onAirportRender;

    const sidebar = document.getElementById("app-sidebar");
    const toggleBtn = document.getElementById("btn-toggle-sidebar");

    // 恢复持久化的侧边栏折叠状态
    const savedCollapsed = localStorage.getItem("nodepilot_sidebar_collapsed") === "true";
    if (savedCollapsed) {
        toggleSidebarCollapse(true);
    }

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => toggleSidebarCollapse());
    }

    // GitHub 仓库快捷链接跳转（兼容 btn-sidebar-github 与历史向后兼容的 btn-sidebar-issue）
    const btnGithub = document.getElementById("btn-sidebar-github") || document.getElementById("btn-sidebar-issue");
    if (btnGithub) {
        btnGithub.addEventListener("click", (e) => {
            e.preventDefault();
            openExternalURL("https://github.com/Aicrosoft/NodePilot");
        });
    }

    // 快捷键 Cmd+B (macOS) / Ctrl+B (Windows/Linux)
    window.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
            e.preventDefault();
            toggleSidebarCollapse();
        }
    });

    const navButtons = document.querySelectorAll(".sidebar-nav .nav-item");
    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const viewName = btn.getAttribute("data-view");
            if (viewName) {
                switchView(viewName);
            }
        });
    });

    // 快速跳转至测速排行榜视图按钮
    const btnJump = document.getElementById("btn-jump-to-benchmark");
    if (btnJump) {
        btnJump.addEventListener("click", () => switchView("benchmark"));
    }

    // 策略与引擎设置保存/重置按钮
    const btnSaveSettings = document.getElementById("btn-save-settings");
    const btnResetSettings = document.getElementById("btn-reset-settings");

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener("click", () => {
            const workers = document.getElementById("settings-default-workers")?.value || "6";
            const timeout = document.getElementById("settings-default-timeout")?.value || "10";
            const tcpTimeout = document.getElementById("settings-tcp-timeout")?.value || "3";
            const enablePrePing = document.getElementById("settings-enable-pre-ping")?.checked !== false;
            const enableIngress = document.getElementById("settings-enable-ingress")?.checked !== false;
            const payloadSize = document.getElementById("settings-ingress-payload-size")?.value || "262144";
            const jitterThreshold = document.getElementById("settings-jitter-threshold")?.value || "150";
            const topN = document.getElementById("settings-top-n")?.value || "5";
            const minScore = document.getElementById("settings-min-score")?.value || "50";
            const autoPersist = document.getElementById("settings-auto-persist")?.checked !== false;
            const showConfirm = document.getElementById("settings-show-benchmark-confirm")?.checked !== false;
            const logLevel = document.getElementById("settings-log-level")?.value || "INFO";

            localStorage.setItem("nodepilot_default_workers", workers);
            localStorage.setItem("nodepilot_default_timeout", timeout);
            localStorage.setItem("nodepilot_tcp_timeout", tcpTimeout);
            localStorage.setItem("nodepilot_enable_pre_ping", enablePrePing ? "true" : "false");
            localStorage.setItem("nodepilot_enable_ingress", enableIngress ? "true" : "false");
            localStorage.setItem("nodepilot_ingress_payload_size", payloadSize);
            localStorage.setItem("nodepilot_jitter_threshold", jitterThreshold);
            localStorage.setItem("nodepilot_top_n", topN);
            localStorage.setItem("nodepilot_min_score", minScore);
            localStorage.setItem("nodepilot_auto_persist", autoPersist ? "true" : "false");
            localStorage.setItem("nodepilot_skip_benchmark_confirm", showConfirm ? "false" : "true");
            localStorage.setItem("nodepilot_log_level", logLevel);

            if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAppSettingsBatch) {
                const batch = {
                    "nodepilot_default_workers": workers,
                    "nodepilot_default_timeout": timeout,
                    "nodepilot_tcp_timeout": tcpTimeout,
                    "nodepilot_enable_pre_ping": enablePrePing ? "true" : "false",
                    "nodepilot_enable_ingress": enableIngress ? "true" : "false",
                    "nodepilot_ingress_payload_size": payloadSize,
                    "nodepilot_jitter_threshold": jitterThreshold,
                    "nodepilot_top_n": topN,
                    "nodepilot_min_score": minScore,
                    "nodepilot_auto_persist": autoPersist ? "true" : "false",
                    "nodepilot_skip_benchmark_confirm": showConfirm ? "false" : "true",
                    "nodepilot_log_level": logLevel
                };
                window.go.main.App.SaveAppSettingsBatch(batch).catch(e => console.error("Failed to save settings to SQLite:", e));
            }

            if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetLogLevel) {
                window.go.main.App.SetLogLevel(logLevel);
            }

            const mainWorkers = document.getElementById("workers");
            if (mainWorkers) mainWorkers.value = workers;

            showToast(t("toast.settings_saved", {}, "💾 Benchmark engine parameters and strategy saved!"));
        });
    }

    if (btnResetSettings) {
        btnResetSettings.addEventListener("click", () => {
            if (confirm(t("settings.confirm_reset", {}, "Are you sure you want to restore all engine parameters and preferences to factory defaults?"))) {
                const defaults = {
                    workers: "6",
                    timeout: "10",
                    tcpTimeout: "3",
                    enablePrePing: true,
                    enableIngress: true,
                    payloadSize: "262144",
                    jitterThreshold: "150",
                    topN: "5",
                    minScore: "50",
                    autoPersist: true,
                    logLevel: "INFO"
                };

                const elW = document.getElementById("settings-default-workers");
                const elT = document.getElementById("settings-default-timeout");
                const elTcp = document.getElementById("settings-tcp-timeout");
                const elPrePing = document.getElementById("settings-enable-pre-ping");
                const elIngress = document.getElementById("settings-enable-ingress");
                const elPayload = document.getElementById("settings-ingress-payload-size");
                const elJitter = document.getElementById("settings-jitter-threshold");
                const elTopN = document.getElementById("settings-top-n");
                const elMinScore = document.getElementById("settings-min-score");
                const elAuto = document.getElementById("settings-auto-persist");
                const elConfirm = document.getElementById("settings-show-benchmark-confirm");
                const elLogLevel = document.getElementById("settings-log-level");

                if (elW) elW.value = defaults.workers;
                if (elT) elT.value = defaults.timeout;
                if (elTcp) elTcp.value = defaults.tcpTimeout;
                if (elPrePing) elPrePing.checked = defaults.enablePrePing;
                if (elIngress) elIngress.checked = defaults.enableIngress;
                if (elPayload) elPayload.value = defaults.payloadSize;
                if (elJitter) elJitter.value = defaults.jitterThreshold;
                if (elTopN) elTopN.value = defaults.topN;
                if (elMinScore) elMinScore.value = defaults.minScore;
                if (elAuto) elAuto.checked = defaults.autoPersist;
                if (elConfirm) elConfirm.checked = true;
                if (elLogLevel) elLogLevel.value = defaults.logLevel;

                localStorage.setItem("nodepilot_skip_benchmark_confirm", "false");
                btnSaveSettings?.click();
            }
        });
    }

    // 日志级别变更监听器
    const elLogLevelSelect = document.getElementById("settings-log-level");
    if (elLogLevelSelect) {
        elLogLevelSelect.addEventListener("change", (e) => {
            const lvl = e.target.value;
            localStorage.setItem("nodepilot_log_level", lvl);
            if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetLogLevel) {
                window.go.main.App.SetLogLevel(lvl);
            }
            showToast(t("settings.toast_log_level_changed", { level: lvl }, `⚙️ Benchmark log level switched to: ${lvl}`));
        });
    }

    // 设置面板选项卡切换
    const settingsTabs = document.querySelectorAll(".settings-nav-tab");
    settingsTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const tabKey = tab.getAttribute("data-tab");
            if (!tabKey) return;

            settingsTabs.forEach(t => t.classList.toggle("active", t === tab));

            const panelProbes = document.getElementById("settings-panel-probes");
            const panelEngine = document.getElementById("settings-panel-engine");
            if (panelProbes) panelProbes.classList.toggle("active", tabKey === "probes");
            if (panelEngine) panelEngine.classList.toggle("active", tabKey === "engine");

            localStorage.setItem("nodepilot_settings_active_tab", tabKey);
        });
    });

    // 探针卡片 API Key 明文/密文查看切换
    document.querySelectorAll(".probe-header-controls .btn-toggle-key").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = btn.parentElement?.querySelector(".probe-key-input");
            if (!input) return;
            if (input.type === "password") {
                input.type = "text";
                btn.innerText = "🔒";
                btn.title = t("settings.hide_key", {}, "Hide Key");
            } else {
                input.type = "password";
                btn.innerText = "👁️";
                btn.title = t("settings.show_key", {}, "Show Key");
            }
        });
    });

    for (const id of PROBE_SERVICE_IDS) {
        const keyInput = document.getElementById(`probe-apikey-${id}`);
        const modelInput = document.getElementById(`probe-model-${id}`);
        if (keyInput) {
            keyInput.addEventListener("input", () => {
                updateProbeStatusBadge(id);
            });
            keyInput.addEventListener("change", () => {
                saveAllProbeSettings(false);
            });
        }
        if (modelInput) {
            modelInput.addEventListener("change", () => {
                saveAllProbeSettings(false);
            });
        }
    }

    const btnSaveProbes = document.getElementById("btn-save-probes");
    if (btnSaveProbes) {
        btnSaveProbes.addEventListener("click", () => {
            saveAllProbeSettings(true);
        });
    }

    // 恢复激活的设置面板选项卡
    const savedSettingsTab = localStorage.getItem("nodepilot_settings_active_tab");
    if (savedSettingsTab === "engine") {
        const engineTabBtn = document.getElementById("tab-btn-settings-engine");
        engineTabBtn?.click();
    }

    // 恢复持久化的引擎设置
    loadSavedSettings();

    // 初始化历史趋势图表
    initHistoryChart();

    // 历史记录展示模式切换（图表 / 列表）
    const btnHistoryChart = document.getElementById("btn-history-mode-chart");
    const btnHistoryList = document.getElementById("btn-history-mode-list");
    if (btnHistoryChart && btnHistoryList) {
        btnHistoryChart.addEventListener("click", () => switchHistoryMode("chart"));
        btnHistoryList.addEventListener("click", () => switchHistoryMode("list"));
    }

    // 清空历史测速归档按钮
    const btnClearHistory = document.getElementById("btn-clear-history");
    if (btnClearHistory) {
        btnClearHistory.addEventListener("click", async () => {
            if (confirm(t("settings.confirm_clear_history", {}, "Are you sure you want to permanently clear all saved benchmark history archives?"))) {
                await clearStoredBenchmarkHistoryAsync();
                await renderHistoryView();
                showToast(t("settings.toast_history_cleared", {}, "🗑️ Benchmark history archives cleared"));
            }
        });
    }

    updateSidebarCounters();
}

function loadSavedSettings() {
    const savedWorkers = localStorage.getItem("nodepilot_default_workers") || "6";
    const savedTimeout = localStorage.getItem("nodepilot_default_timeout") || "10";
    const savedTcp = localStorage.getItem("nodepilot_tcp_timeout") || "3";
    const savedPrePing = localStorage.getItem("nodepilot_enable_pre_ping");
    const savedIngress = localStorage.getItem("nodepilot_enable_ingress");
    const savedPayload = localStorage.getItem("nodepilot_ingress_payload_size") || "262144";
    const savedJitter = localStorage.getItem("nodepilot_jitter_threshold") || "150";
    const savedTopN = localStorage.getItem("nodepilot_top_n") || "5";
    const savedMinScore = localStorage.getItem("nodepilot_min_score") || "50";
    const savedAuto = localStorage.getItem("nodepilot_auto_persist");
    const savedLogLevel = localStorage.getItem("nodepilot_log_level") || "INFO";

    const elW = document.getElementById("settings-default-workers");
    const elT = document.getElementById("settings-default-timeout");
    const elTcp = document.getElementById("settings-tcp-timeout");
    const elPrePing = document.getElementById("settings-enable-pre-ping");
    const elIngress = document.getElementById("settings-enable-ingress");
    const elPayload = document.getElementById("settings-ingress-payload-size");
    const elJitter = document.getElementById("settings-jitter-threshold");
    const elTopN = document.getElementById("settings-top-n");
    const elMinScore = document.getElementById("settings-min-score");
    const elAuto = document.getElementById("settings-auto-persist");
    const elConfirm = document.getElementById("settings-show-benchmark-confirm");
    const elLogLevel = document.getElementById("settings-log-level");

    if (elW) elW.value = savedWorkers;
    if (elT) elT.value = savedTimeout;
    if (elTcp) elTcp.value = savedTcp;
    if (elPrePing && savedPrePing !== null) elPrePing.checked = (savedPrePing === "true");
    if (elIngress && savedIngress !== null) elIngress.checked = (savedIngress === "true");
    if (elPayload) elPayload.value = savedPayload;
    if (elJitter) elJitter.value = savedJitter;
    if (elTopN) elTopN.value = savedTopN;
    if (elMinScore) elMinScore.value = savedMinScore;
    if (elAuto && savedAuto !== null) elAuto.checked = (savedAuto === "true");
    const savedSkip = localStorage.getItem("nodepilot_skip_benchmark_confirm") === "true";
    if (elConfirm) elConfirm.checked = !savedSkip;
    if (elLogLevel) elLogLevel.value = savedLogLevel;

    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetLogLevel) {
        window.go.main.App.SetLogLevel(savedLogLevel);
    }

    const mainW = document.getElementById("workers");
    if (mainW) mainW.value = savedWorkers;

    // 加载探针密钥与模型配置
    for (const id of PROBE_SERVICE_IDS) {
        const savedKey = localStorage.getItem(`nodepilot_probe_apikey_${id}`) || "";
        const savedModel = localStorage.getItem(`nodepilot_probe_model_${id}`) || "";
        const keyInput = document.getElementById(`probe-apikey-${id}`);
        const modelInput = document.getElementById(`probe-model-${id}`);
        if (keyInput) keyInput.value = savedKey;
        if (modelInput && savedModel) modelInput.value = savedModel;
        updateProbeStatusBadge(id);
    }
}

/**
 * 切换主舞台当前展示的激活视图面板。
 * @param {string} viewName - 视图标识 ("benchmark" | "airports" | "history" | "settings")
 */
export function switchView(viewName) {
    if (!viewName) return;
    currentActiveView = viewName;

    // 1. 更新侧边栏导航项的高亮激活状态
    document.querySelectorAll(".sidebar-nav .nav-item").forEach(btn => {
        if (btn.getAttribute("data-view") === viewName) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    // 2. 切换主舞台 View Panel 的显隐状态
    document.querySelectorAll(".app-main-stage .view-panel").forEach(panel => {
        if (panel.id === `view-${viewName}`) {
            panel.classList.remove("hidden");
            panel.classList.add("active");
        } else {
            panel.classList.add("hidden");
            panel.classList.remove("active");
        }
    });

    // 3. 针对特定视图触发初次加载渲染
    if (viewName === "airports" && typeof onAirportRenderRequested === "function") {
        onAirportRenderRequested();
    } else if (viewName === "history") {
        renderHistoryView();
    }

    updateSidebarCounters();
}

/**
 * 更新侧边栏底部的机场与可用节点计数指示器。
 * @param {number|null} selectedAirportCount - 选中的机场数量
 * @param {number|null} readyNodesCount - 就绪的节点数量
 */
export function updateSidebarCounters(selectedAirportCount = null, readyNodesCount = null) {
    const airports = getStoredAirports();
    const airportBadge = document.getElementById("sidebar-airport-count");
    if (airportBadge) {
        airportBadge.innerText = `${airports.length}`;
    }

    const readyText = document.getElementById("sidebar-ready-status");
    const descText = document.getElementById("sidebar-selected-airports-desc");

    let totalNodes = 0;
    airports.forEach(a => {
        totalNodes += (a.nodeCount || 0);
    });

    if (readyText) {
        const displayNodes = readyNodesCount !== null ? readyNodesCount : totalNodes;
        readyText.innerText = t("sidebar.ready_status", { nodes: displayNodes }, `Ready: ${displayNodes} Nodes`);
    }

    if (descText) {
        const selCount = selectedAirportCount !== null ? selectedAirportCount : airports.filter(a => a.nodeCount > 0).length;
        descText.innerText = t("sidebar.selected_airports", { count: selCount, total: airports.length }, `${selCount} / ${airports.length} Airports`);
    }
}

/**
 * 切换历史记录视图的呈现模式（折线图趋势 / 卡片时间线列表）。
 * @param {string} mode - 呈现模式 ("chart" | "list")
 */
export function switchHistoryMode(mode = "chart") {
    localStorage.setItem("nodepilot_history_view_mode", mode);
    const btnChart = document.getElementById("btn-history-mode-chart");
    const btnList = document.getElementById("btn-history-mode-list");
    const chartMount = document.getElementById("history-chart-mount");
    const cardsMount = document.getElementById("history-cards-mount");

    if (btnChart && btnList) {
        if (mode === "chart") {
            btnChart.classList.add("active");
            btnList.classList.remove("active");
            if (chartMount) chartMount.classList.remove("hidden");
            if (cardsMount) cardsMount.classList.add("hidden");
        } else {
            btnChart.classList.remove("active");
            btnList.classList.add("active");
            if (chartMount) chartMount.classList.add("hidden");
            if (cardsMount) cardsMount.classList.remove("hidden");
        }
    }
}

/**
 * 渲染历史记录视图（时序图表与历史归档卡片列表）。
 */
export async function renderHistoryView() {
    const chartMount = document.getElementById("history-chart-mount");
    const cardsMount = document.getElementById("history-cards-mount");
    if (!chartMount || !cardsMount) return;

    const list = await getStoredBenchmarkHistoryAsync();

    // 1. 渲染时序趋势折线图
    renderHistoryChart(list);

    // 2. 渲染历史记录卡片列表
    if (!list || list.length === 0) {
        const emptyTitle = t("history.empty_title", {}, "No benchmark history data");
        const emptyDesc = t("history.empty_desc", {}, "After running benchmarks, results will be archived here by airport, node, and test time.");
        cardsMount.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 60px 20px;">
                <div style="font-size: 2.2rem; margin-bottom: 12px;">📊</div>
                <div style="font-size: 1rem; font-weight: 500; color: var(--text-secondary);">${emptyTitle}</div>
                <p style="font-size: 0.85rem; margin-top: 6px;">${emptyDesc}</p>
            </div>
        `;
    } else {
        // 按测试时间倒序分组归档
        const timeMap = new Map();
        list.forEach(r => {
            const timeKey = r.tested_time_display || formatFullDateTime(r.tested_at || new Date().toISOString());
            if (!timeMap.has(timeKey)) {
                timeMap.set(timeKey, []);
            }
            timeMap.get(timeKey).push(r);
        });

        const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => {
            const da = new Date(a).getTime() || 0;
            const db = new Date(b).getTime() || 0;
            return db - da;
        });

        let html = `<div class="history-timeline">`;

        sortedTimes.forEach((timeKey) => {
            const items = timeMap.get(timeKey);
            const topItem = items.slice().sort((a, b) => b.score - a.score)[0];
            const availCount = items.filter(i => i.status === "Available" || i.status === "Authentication Required").length;

            const availText = t("history.avail_ratio", { avail: availCount, total: items.length }, `Availability ${availCount}/${items.length}`);
            const countText = t("history.tested_metrics", { count: items.length }, `Tested ${items.length} metrics`);
            const bestNodeText = t("history.best_node", {}, "Best Node:");
            const scoreText = t("history.score", { score: topItem.score.toFixed(1) }, `Score ${topItem.score.toFixed(1)}`);

            html += `
                <div class="history-card">
                    <div class="history-card-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 1rem;">🕒</span>
                            <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(timeKey)}</strong>
                            <span class="badge" style="background: rgba(16,185,129,0.12); color: var(--accent-green); font-size: 0.72rem;">
                                ${escapeHtml(availText)}
                            </span>
                        </div>
                        <div style="font-size: 0.82rem; color: var(--text-muted);">
                            ${escapeHtml(countText)}
                        </div>
                    </div>
                    <div class="history-card-body">
                        <div class="history-top-item">
                            <span style="color: var(--text-secondary); font-size: 0.82rem;">${escapeHtml(bestNodeText)}</span>
                            <span class="airport-tag">${escapeHtml(topItem.airport_name || "default")}</span>
                            <strong style="color: var(--text-primary); font-size: 0.85rem;">${escapeHtml(topItem.node_name)}</strong>
                            <span style="margin-left: auto; color: var(--accent-green); font-weight: 700; font-size: 0.9rem;">
                                🏆 ${escapeHtml(scoreText)}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        cardsMount.innerHTML = html;
    }

    // 3. 恢复用户偏好的历史展示模式
    const savedMode = localStorage.getItem("nodepilot_history_view_mode") || "chart";
    switchHistoryMode(savedMode);
}
