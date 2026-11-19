/**
 * benchmark.js
 * 基准测试调度引擎：负责并发压测任务编排、Wails 事件流监听、核心排行榜动态渲染及代理策略组导出。
 */

import { escapeHtml, showToast, extractMetrics, getScoreLevelClass, openConfirmModal } from "./utils.js";
import {
    getStoredBenchmarkResults,
    saveStoredBenchmarkResults,
    syncBenchmarkResultsToAirports
} from "./store.js";
import { clearAirportSelection } from "./airport_manager.js";
import {
    initTableColumnResizer,
    applyTableColumnWidths,
    BENCHMARK_COL_CONFIGS
} from "./table_resizer.js";
import { t } from "./i18n/i18n.js";

let allResults = [];
let activeService = "Google Antigravity";

export function getAllBenchmarkResults() {
    return allResults;
}

function getProbeIdByName(name) {
    if (!name) return "";
    const n = name.toLowerCase();
    if (n.includes("antigravity")) return "google-antigravity";
    if (n.includes("gemini")) return "google-gemini";
    if (n.includes("openai") || n.includes("chatgpt")) return "openai";
    if (n.includes("claude") || n.includes("anthropic")) return "anthropic-claude";
    if (n.includes("cursor")) return "cursor";
    return name;
}

/**
 * 初始化基准测试模块：绑定控制栏交互、事件流监听及数据回显
 * @param {Function} getCurrentNodes - 获取当前已选有效测试节点列表的访问器函数
 */
export function initBenchmark(getCurrentNodes) {
    const btnStart = document.getElementById("btn-start");
    const progressSection = document.getElementById("progress-section");
    const progressBarFill = document.getElementById("progress-bar-fill");
    const progressText = document.getElementById("progress-text");
    const progressPercent = document.getElementById("progress-percent");
    const tabsContainer = document.getElementById("service-tabs");

    const btnExportClash = document.getElementById("btn-export-clash");
    const btnExportMD = document.getElementById("btn-export-md");
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalText = document.getElementById("modal-text");
    const modalClose = document.getElementById("modal-close");
    const btnCopy = document.getElementById("btn-copy");

    // 1. 恢复本地持久化保存的基准测试历史数据并渲染初始表格
    const savedResults = getStoredBenchmarkResults();
    if (Array.isArray(savedResults) && savedResults.length > 0) {
        allResults = savedResults;
    }
    renderTable(typeof getCurrentNodes === "function" ? getCurrentNodes() : []);

    // 初始化主表格列宽拖拽调整器与偏好设置记忆
    const benchmarkTable = document.getElementById("benchmark-table");
    if (benchmarkTable) {
        initTableColumnResizer(benchmarkTable, "nodepilot_col_widths_benchmark", BENCHMARK_COL_CONFIGS);
    }

    // 2. 目标服务多选下拉框、偏好持久化及双向同步
    initServicesSelection();

    const btnDropdownServices = document.getElementById("btn-dropdown-services");
    const panelDropdownServices = document.getElementById("dropdown-services-panel");
    const dropdownWrapServices = document.getElementById("dropdown-services");
    const btnToggleAllServices = document.getElementById("btn-toggle-all-services");

    if (btnDropdownServices && panelDropdownServices) {
        btnDropdownServices.addEventListener("click", (e) => {
            e.stopPropagation();
            document.querySelectorAll(".multi-select-dropdown").forEach(el => {
                if (el !== dropdownWrapServices) {
                    el.classList.remove("open");
                    el.querySelector(".dropdown-menu-panel")?.classList.add("hidden");
                }
            });
            const isHidden = panelDropdownServices.classList.contains("hidden");
            if (isHidden) {
                panelDropdownServices.classList.remove("hidden");
                dropdownWrapServices?.classList.add("open");
            } else {
                panelDropdownServices.classList.add("hidden");
                dropdownWrapServices?.classList.remove("open");
            }
        });

        panelDropdownServices.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        // 点击外部区域自动收起所有下拉菜单面板
        document.addEventListener("click", () => {
            document.querySelectorAll(".multi-select-dropdown").forEach(el => {
                el.classList.remove("open");
                el.querySelector(".dropdown-menu-panel")?.classList.add("hidden");
            });
        });
    }

    // 快速清空已选机场与 AI 服务快捷按钮
    const btnClearSelection = document.getElementById("btn-clear-selection");
    if (btnClearSelection) {
        btnClearSelection.addEventListener("click", () => {
            clearAirportSelection(nodes => {
                renderTable(nodes);
            });
            clearServiceSelection();
            showToast(t("toast.selection_cleared", {}, "🧹 Cleared selected airports and AI services"));
        });
    }

    if (btnToggleAllServices) {
        btnToggleAllServices.addEventListener("click", () => {
            const allBoxes = document.querySelectorAll('input[name="service"]');
            const checkedBoxes = document.querySelectorAll('input[name="service"]:checked');
            const willCheck = checkedBoxes.length !== allBoxes.length;
            allBoxes.forEach(cb => cb.checked = willCheck);
            const currentChecked = getSelectedServices();
            localStorage.setItem("nodepilot_selected_services", JSON.stringify(currentChecked));
            updateServicesDropdownTriggerText();
        });
    }

    // 3. 监听 Wails 后端事件流
    if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn("benchmark_progress", (data) => {
            if (progressSection) progressSection.classList.remove("hidden");
            if (progressBarFill) progressBarFill.style.width = `${data.percent}%`;
            if (progressPercent) progressPercent.innerText = `${data.percent}%`;
            if (progressText) {
                progressText.innerText = t("toolbar.progress_testing", {
                    completed: data.completed,
                    total: data.total,
                    node: data.latest?.node_name || "",
                    service: data.latest?.service_name || ""
                }, `[${data.completed}/${data.total}] Testing: ${data.latest?.node_name || ""} -> ${data.latest?.service_name || ""}`);
            }
        });
    }

    // 4. 触发多维基准测试并发评测任务
    if (btnStart) {
        btnStart.addEventListener("click", async () => {
            const currentNodes = typeof getCurrentNodes === "function" ? getCurrentNodes() : [];
            if (!currentNodes || currentNodes.length === 0) {
                const btnAirports = document.getElementById("btn-dropdown-airports");
                if (btnAirports) {
                    btnAirports.classList.remove("highlight-pulse");
                    void btnAirports.offsetWidth;
                    btnAirports.classList.add("highlight-pulse");
                }
                showToast(t("benchmark.alert_no_nodes", {}, "⚠️ No test nodes selected: Please select airports with valid nodes in the dropdown menu above!"), "warning");
                return;
            }

            // 为后端节点结构补齐 airport_name 标识
            currentNodes.forEach(n => {
                if (n && !n.airport_name && n.airportName) {
                    n.airport_name = n.airportName;
                }
            });

            const selectedServices = getSelectedServices();
            if (selectedServices.length === 0) {
                const btnServices = document.getElementById("btn-dropdown-services");
                if (btnServices) {
                    btnServices.classList.remove("highlight-pulse");
                    void btnServices.offsetWidth;
                    btnServices.classList.add("highlight-pulse");
                }
                showToast(t("benchmark.alert_no_services", {}, "⚠️ No benchmark targets selected: Please select at least one service in the AI services dropdown above!"), "warning");
                return;
            }

            // 从偏好设置读取并发测试协程数（默认 6 协程并发）
            const workers = parseInt(localStorage.getItem("nodepilot_default_workers") || "6", 10) || 6;

            // 检查所选服务是否缺失 API Key 配置
            const unconfiguredServices = [];
            selectedServices.forEach(srv => {
                const pid = getProbeIdByName(srv);
                const key = (localStorage.getItem(`nodepilot_probe_apikey_${pid}`) || "").trim();
                if (!key) {
                    unconfiguredServices.push(srv);
                }
            });

            const skipConfirm = localStorage.getItem("nodepilot_skip_benchmark_confirm") === "true";
            if (skipConfirm) {
                if (unconfiguredServices.length > 0) {
                    showToast(t("benchmark.toast_missing_config", { services: unconfiguredServices.join(", ") }, `⚠️ Missing API Key warning: [${unconfiguredServices.join(", ")}] not configured with API Key, benchmark will only execute keyless connectivity check`), "warning");
                }
                await runBenchmarkProcess(currentNodes, selectedServices, workers);
                return;
            }

            // 弹出独立节点隧道测速原理说明对话框（支持完整多语言）
            const confirmTitle = t("benchmark_modal.title", {}, "🚀 Independent Node Tunnel Benchmark Explanation");
            const bannerTitle = t("benchmark_modal.banner", {}, "ℹ️ NodePilot underlying benchmark tunnel & external proxy compatibility:");
            const itemCore = t("benchmark_modal.item_core", {}, "<strong>Built-in Independent Core</strong>: NodePilot embeds an independent outbound protocol stack; each node forms an independent encrypted tunnel directly handshaking with physical servers;");
            const itemRules = t("benchmark_modal.item_rules", {}, "<strong>Routing Rule Compatibility</strong>: Most airport server endpoints are automatically set to DIRECT by routing rules in external proxies (Clash / Surge), avoiding conflicts;");
            const itemTun = t("benchmark_modal.item_tun", {}, "<strong>TUN Global Mode Notice</strong>: Physical latency may add routing overhead only if external proxy enables system-level TUN mode without direct routing. Regular system proxy does not need to be turned off.");
            const questionText = t("benchmark_modal.question", { count: currentNodes.length }, `Confirm starting independent concurrent benchmark for <strong>${currentNodes.length}</strong> nodes?`);
            const skipChkText = t("benchmark_modal.skip_chk", {}, "Remember choice, start benchmark directly next time (can be re-enabled in Preferences)");
            const btnStartText = t("benchmark_modal.btn_start", {}, "🚀 Start Benchmark");
            const btnCancelText = t("modal.cancel", {}, "Cancel");

            let missingConfigNotice = "";
            if (unconfiguredServices.length > 0) {
                const missingTitle = t("benchmark_modal.missing_key_title", {}, "⚠️ Missing API Key Notice:");
                const missingServices = t("benchmark_modal.missing_key_services", { services: unconfiguredServices.join(", ") }, `Detected AI services <strong>${unconfiguredServices.join(", ")}</strong> without configured API Key.`);
                const missingDesc = t("benchmark_modal.missing_key_desc", {}, "This benchmark will only perform keyless basic connectivity probes (TPS rate and Jitter will display as N/A). To enable full testing (streaming benchmark), configure keys and models in 'Preferences -> AI Service Probe Specification'.");

                missingConfigNotice = `
                    <div style="margin: 0 0 12px 0; padding: 10px 14px; background: rgba(245, 158, 11, 0.1); border-left: 3px solid var(--accent-yellow); border-radius: 6px; font-size: 0.82rem; line-height: 1.55;">
                        <strong style="color: var(--accent-yellow);">${missingTitle}</strong><br/>
                        ${missingServices}<br/>
                        <span style="color: var(--text-secondary); font-size: 0.8rem;">
                            ${missingDesc}
                        </span>
                    </div>
                `;
            }

            const confirmMsg = `
                <div style="font-size: 0.88rem; line-height: 1.6; color: var(--text-primary);">
                    <p style="margin: 0 0 10px 0; font-weight: 600; color: var(--accent-primary);">
                        ${bannerTitle}
                    </p>
                    <ul style="margin: 0 0 12px 18px; padding: 0; color: var(--text-secondary); font-size: 0.84rem; line-height: 1.55;">
                        <li style="margin-bottom: 6px;">${itemCore}</li>
                        <li style="margin-bottom: 6px;">${itemRules}</li>
                        <li>${itemTun}</li>
                    </ul>
                    ${missingConfigNotice}
                    <p style="margin: 0 0 14px 0; color: var(--text-primary); font-size: 0.85rem;">
                        ${questionText}
                    </p>
                    <div style="padding-top: 10px; border-top: 1px solid var(--border-subtle);">
                        <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem; color: var(--text-muted); user-select: none;">
                            <input type="checkbox" id="chk-skip-benchmark-confirm" style="cursor: pointer; accent-color: var(--accent-primary);" />
                            ${skipChkText}
                        </label>
                    </div>
                </div>
            `;

            openConfirmModal(
                confirmTitle,
                confirmMsg,
                async () => {
                    const chkSkip = document.getElementById("chk-skip-benchmark-confirm");
                    if (chkSkip && chkSkip.checked) {
                        localStorage.setItem("nodepilot_skip_benchmark_confirm", "true");
                    }
                    await runBenchmarkProcess(currentNodes, selectedServices, workers);
                },
                btnStartText,
                "btn-primary",
                btnCancelText
            );
        });
    }

    async function runBenchmarkProcess(currentNodes, selectedServices, workers) {
        btnStart.disabled = true;
        btnStart.innerText = t("toolbar.running_benchmark", {}, "⏳ Benchmarking...");
        if (progressSection) progressSection.classList.remove("hidden");
        if (progressBarFill) progressBarFill.style.width = "0%";
        if (progressPercent) progressPercent.innerText = "0%";
        if (progressText) progressText.innerText = t("toolbar.progress_preparing", { count: currentNodes.length }, `Preparing to benchmark ${currentNodes.length} filtered nodes...`);

        try {
            // 从偏好设置读取 Pre-ping 前置轻量测活开关（默认开启）
            const enablePrePing = localStorage.getItem("nodepilot_enable_pre_ping") !== "false";
            allResults = await window.go.main.App.RunBenchmark(currentNodes, selectedServices, workers, 10, enablePrePing);

            // 赋予统一批次时间戳，确保同一批次节点在时序图表中精准垂直对齐
            const batchNow = new Date().toISOString();
            if (Array.isArray(allResults)) {
                allResults.forEach(r => {
                    r.batch_time = batchNow;
                    r.tested_time_display = r.tested_time_display || r.tested_at;
                });
            }

            // 评测结果持久化存储
            saveStoredBenchmarkResults(allResults, currentNodes);
            // 回写评测指标至所属机场节点对象并保存
            syncBenchmarkResultsToAirports(allResults);
            allResults = getStoredBenchmarkResults();
            renderTable(currentNodes);
            if (progressText) progressText.innerText = t("toolbar.progress_done", { items: allResults.length, nodes: currentNodes.length }, `✅ Benchmark completed! Evaluated ${allResults.length} metric items across ${currentNodes.length} valid nodes`);
            if (progressBarFill) progressBarFill.style.width = "100%";
            if (progressPercent) progressPercent.innerText = "100%";
            showToast(t("benchmark.toast_completed", { count: currentNodes.length }, `🎉 Benchmark completed! Evaluated ${currentNodes.length} filtered nodes and persisted full metrics`));
        } catch (err) {
            alert(t("benchmark.alert_benchmark_error", { error: err }, "Benchmark execution error: " + err));
        } finally {
            btnStart.disabled = false;
            btnStart.innerText = t("toolbar.start_benchmark", {}, "🚀 Start Benchmark");
        }
    }

    // 5. AI 服务标签页切换
    if (tabsContainer) {
        tabsContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".tab-btn");
            if (btn) {
                document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                activeService = btn.getAttribute("data-service");
                renderTable(typeof getCurrentNodes === "function" ? getCurrentNodes() : []);
            }
        });
    }

    // 6. 导出优选策略组配置（Clash / Mihomo）
    if (btnExportClash) {
        btnExportClash.addEventListener("click", async () => {
            if (!allResults || allResults.length === 0) {
                showToast(t("table.empty_prompt", {}, "No benchmark data available. Please select airports and services above to start benchmarking"), "warning");
                return;
            }
            try {
                const yamlStr = await window.go.main.App.ExportClashGroups(allResults, 5);
                showExportModal(t("export.export_clash", {}, "Clash / Mihomo Preferred Proxy Groups (Top 5)"), yamlStr);
            } catch (err) {
                alert(t("benchmark.alert_export_error", { error: err }, "Export error: " + err));
            }
        });
    }

    // 7. 导出 Markdown 格式基准评测报告
    if (btnExportMD) {
        btnExportMD.addEventListener("click", async () => {
            if (!allResults || allResults.length === 0) {
                showToast(t("table.empty_prompt", {}, "No benchmark data available. Please select airports and services above to start benchmarking"), "warning");
                return;
            }
            try {
                const mdStr = await window.go.main.App.ExportMarkdownReport(allResults);
                showExportModal(t("export.export_report", {}, "Markdown Benchmark Report"), mdStr);
            } catch (err) {
                alert(t("benchmark.alert_export_error", { error: err }, "Export error: " + err));
            }
        });
    }

    // 8. 导出结果通用浮层模态框交互绑定
    if (modalClose && modal) modalClose.addEventListener("click", () => modal.classList.add("hidden"));
    if (btnCopy && modalText) {
        btnCopy.addEventListener("click", () => {
            modalText.select();
            document.execCommand("copy");
            btnCopy.innerText = t("export.copy_success", {}, "✅ Copied");
            setTimeout(() => {
                if (btnCopy) btnCopy.innerText = t("export.copy_clipboard", {}, "Copy to Clipboard");
            }, 1500);
        });
    }
}

/**
 * 初始化 AI 服务多选下拉列表状态并绑定变更事件
 */
function initServicesSelection() {
    let savedList = []; // 默认全不选，仅当用户显式勾选并保存后恢复
    const raw = localStorage.getItem("nodepilot_selected_services");
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                savedList = parsed;
            }
        } catch (e) { }
    }

    const serviceCheckboxes = document.querySelectorAll('input[name="service"]');
    serviceCheckboxes.forEach(cb => {
        cb.checked = savedList.includes(cb.value);
        cb.addEventListener("change", () => {
            const currentChecked = getSelectedServices();
            localStorage.setItem("nodepilot_selected_services", JSON.stringify(currentChecked));
            updateServicesDropdownTriggerText();
        });
    });

    updateServicesDropdownTriggerText();
}

/**
 * 清空当前选中的所有目标 AI 评测服务
 */
export function clearServiceSelection() {
    const serviceCheckboxes = document.querySelectorAll('input[name="service"]');
    serviceCheckboxes.forEach(cb => {
        cb.checked = false;
    });
    localStorage.setItem("nodepilot_selected_services", JSON.stringify([]));
    updateServicesDropdownTriggerText();
}

/**
 * 更新目标服务下拉触发按钮的摘要显示文案
 */
export function updateServicesDropdownTriggerText() {
    const triggerText = document.getElementById("dropdown-services-text");
    if (!triggerText) return;
    const allBoxes = document.querySelectorAll('input[name="service"]');
    const checkedBoxes = document.querySelectorAll('input[name="service"]:checked');
    if (checkedBoxes.length === 0) {
        triggerText.innerText = t("toolbar.services_unselected", {}, "Target Services: None (0)");
    } else if (checkedBoxes.length === allBoxes.length) {
        triggerText.innerText = t("toolbar.services_all", { count: allBoxes.length }, `Target Services: All (${allBoxes.length})`);
    } else {
        triggerText.innerText = t("toolbar.services_count", { count: checkedBoxes.length }, `Target Services: ${checkedBoxes.length} Selected`);
    }
}

/**
 * 弹出通用文本导出对话框
 * @param {string} title - 对话框标题
 * @param {string} text - 待展示与复制的文本内容
 */
function showExportModal(title, text) {
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalText = document.getElementById("modal-text");
    const btnCopy = document.getElementById("btn-copy");
    const tabsBar = document.getElementById("export-tabs-bar");
    const exportInfo = document.getElementById("modal-export-info");

    if (tabsBar) tabsBar.style.display = "none";
    if (exportInfo) exportInfo.innerText = "";
    if (modalTitle) modalTitle.innerText = title;
    if (modalText) modalText.value = text;
    if (btnCopy) btnCopy.innerText = t("export.copy_clipboard", {}, "Copy to Clipboard");
    if (modal) modal.classList.remove("hidden");
}

/**
 * 获取当前已勾选的目标 AI 服务名称列表
 * @returns {Array<string>}
 */
export function getSelectedServices() {
    const checked = [];
    document.querySelectorAll('input[name="service"]:checked').forEach(cb => {
        checked.push(cb.value);
    });
    return checked;
}

/**
 * 渲染主评测排行榜数据表格（严格基于当前已选机场与过滤后节点集）
 * @param {Array<Object>} [currentNodes=[]] - 当前生效的节点全集
 */
export function renderTable(currentNodes = []) {
    const tableBody = document.getElementById("table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    // 若当前未选中任何机场或所有节点均被正则过滤排除
    if (!Array.isArray(currentNodes) || currentNodes.length === 0) {
        const emptyMsg = t("table.empty_prompt", {}, "No airports selected or all nodes filtered out by rules. Please select airports above");
        tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center; color: var(--text-muted); padding: 40px;">${emptyMsg}</td></tr>`;
        return;
    }

    // 从持久化存储与运行态缓存读取评测结果集
    const storedResults = getStoredBenchmarkResults();
    const benchmarkPool = (Array.isArray(allResults) && allResults.length > 0) ? allResults : storedResults;

    // 构建快速哈希索引表（支持 机场名+节点名 与 单节点名 级联匹配）
    const resultsMap = new Map();
    if (Array.isArray(benchmarkPool)) {
        benchmarkPool.forEach(r => {
            const matchService = r.service_name && (
                r.service_name.toLowerCase().includes(activeService.toLowerCase()) ||
                activeService.toLowerCase().includes(r.service_name.toLowerCase())
            );
            if (!matchService) return;

            const apName = r.airport_name || "";
            if (apName) {
                resultsMap.set(`${apName}:::${r.node_name}`, r);
            }
            if (!resultsMap.has(r.node_name)) {
                resultsMap.set(r.node_name, r);
            }
        });
    }

    // 组装当前生效节点的渲染行模型视图
    const items = currentNodes.map(node => {
        const apName = node.airportName || node.airport_name || "";
        let res = resultsMap.get(`${apName}:::${node.name}`) || resultsMap.get(node.name);

        // 若主结果池未命中，尝试从 node 对象的 benchmarkResults 字典回退检索
        if (!res && node.benchmarkResults) {
            for (const [offer, bData] of Object.entries(node.benchmarkResults)) {
                if (offer.toLowerCase().includes(activeService.toLowerCase()) ||
                    activeService.toLowerCase().includes(offer.toLowerCase())) {
                    res = bData;
                    break;
                }
            }
        }

        return {
            node,
            airportName: apName,
            result: res || null
        };
    });

    // 多维综合排序：有评分记录按分数降序排列，未评测节点沉底
    items.sort((a, b) => {
        const scoreA = (a.result && typeof a.result.score === "number") ? a.result.score : -1;
        const scoreB = (b.result && typeof b.result.score === "number") ? b.result.score : -1;
        return scoreB - scoreA;
    });

    let rankCounter = 1;
    items.forEach((item) => {
        const tr = document.createElement("tr");
        const node = item.node;
        const r = item.result;
        const airportName = item.airportName;

        const untestedTitle = t("table.untested_tip", { service: activeService }, `Node has not been benchmarked for '${activeService}'. Click 'Start Benchmark' at top right to test`);
        let rankHtml = `<span class="rank rank-untested">-</span>`;
        let statusHtml = `<span class="status-pill status-untested" title="${escapeHtml(untestedTitle)}">${t("table.status_untested", {}, "Untested")}</span>`;
        let pingHtml = `<span style="color:var(--text-muted);">-</span>`;
        let ttfb = `<span style="color:var(--text-muted);">-</span>`;
        let ttft = `<span style="color:var(--text-muted);">-</span>`;
        let tps = `<span style="color:var(--text-muted);">-</span>`;
        let jitter = `<span style="color:var(--text-muted);">-</span>`;
        let bwStr = `<span style="color:var(--text-muted);">-</span>`;
        let scoreHtml = `<span class="score-box score-level-untested">-</span>`;

        if (r) {
            const m = extractMetrics(r);
            const isAvail = (m.status === "Available" || m.status === "Authentication Required");
            const statusClass = isAvail ? "status-avail" : "status-unavail";

            // 节点 Pre-ping 轻量级直连物理握手时延
            const pingMs = m.ping_ms || (typeof r.ping_ms === "number" ? r.ping_ms : 0);
            const pingStatus = m.ping_status || r.ping_status || "";
            if (pingStatus === "ok" || pingMs > 0) {
                let pingClass = "ping-fast";
                if (pingMs > 300) pingClass = "ping-slow";
                else if (pingMs > 150) pingClass = "ping-medium";
                const pingTip = t("nodes_modal.ping_tip", { ms: pingMs }, `Node handshake latency: ${pingMs}ms`);
                pingHtml = `<span class="ping-badge ${pingClass}" title="${escapeHtml(pingTip)}">⚡ ${pingMs}ms</span>`;
            } else if (pingStatus === "unreachable" || r.status === "Unavailable" || r.status === "Timeout") {
                const failTip = r.error_msg
                    ? `title="${escapeHtml(t("nodes_modal.ping_fail_tip", { error: r.error_msg }, `❌ Node connection failed:\n${r.error_msg}`))}"`
                    : `title="${escapeHtml(t("nodes_modal.ping_offline_tip", {}, "❌ Node offline unreachable"))}"`;
                pingHtml = `<span class="ping-badge ping-fail" ${failTip} style="cursor:help;">${t("table.ping_unreachable", {}, "❌ Offline")}</span>`;
            } else if (pingStatus === "skipped") {
                const skipTip = t("table.ping_skipped_tip", {}, "Pre-ping lightweight probe skipped");
                pingHtml = `<span style="color:var(--text-muted); font-size:0.75rem;" title="${escapeHtml(skipTip)}">${t("table.ping_skipped", {}, "Skipped")}</span>`;
            }

            // 榜单名次序号渲染（前三名高亮徽章）
            if (rankCounter === 1) rankHtml = `<span class="rank top1">1</span>`;
            else if (rankCounter === 2) rankHtml = `<span class="rank top2">2</span>`;
            else if (rankCounter === 3) rankHtml = `<span class="rank top3">3</span>`;
            else rankHtml = `<span class="rank">${rankCounter}</span>`;
            rankCounter++;

            const errTip = r.error_msg
                ? `title="${escapeHtml(t("nodes_modal.fail_reason_tip", { error: r.error_msg }, `❌ Failure reason:\n${r.error_msg}`))}"`
                : `title="${escapeHtml(t("nodes_modal.service_status_tip", { status: m.status }, `Service status: ${m.status}`))}"`;
            statusHtml = `<span class="status-pill ${statusClass}" ${errTip} style="cursor: ${r.error_msg ? 'help' : 'default'};">${m.status}</span>`;
            ttfb = m.ttfb_ms > 0 ? `${m.ttfb_ms}ms` : (isAvail ? "< 1ms" : "-");
            ttft = m.ttft_ms > 0 ? `${m.ttft_ms}ms` : (isAvail ? `${ttfb}` : "-");
            const pid = getProbeIdByName(m.ai_offer || activeService);
            const hasConfiguredKey = (localStorage.getItem(`nodepilot_probe_apikey_${pid}`) || "").trim().length > 0;
            const tpsTip = hasConfiguredKey
                ? t("table.tip_tps_zero", {}, "💡 No valid SSE token stream received, TPS is 0")
                : t("table.tip_missing_config_tps", {}, "💡 Missing API Key: Basic connectivity probe only. Configure keys in \"Settings -> AI Service Probes\" for streaming benchmarks");
            const jitterTip = hasConfiguredKey
                ? t("table.tip_jitter_zero", {}, "💡 No token stream variance generated")
                : t("table.tip_missing_config_jitter", {}, "💡 Missing API Key: No token stream, thus no jitter variance");

            tps = m.tps > 0 ? m.tps.toFixed(1) : (isAvail ? `<span style="color:var(--text-muted); font-size:0.75rem; cursor:help;" title="${escapeHtml(tpsTip)}">N/A</span>` : "-");
            jitter = m.jitter_ms > 0.05 ? `${m.jitter_ms.toFixed(1)}ms` : (isAvail ? `<span style="color:var(--text-muted); font-size:0.75rem; cursor:help;" title="${escapeHtml(jitterTip)}">N/A</span>` : "-");

            if (m.ingress_bps > 0) {
                const mbps = (m.ingress_bps * 8) / (1024 * 1024);
                const mBps = m.ingress_bps / (1024 * 1024);
                bwStr = `${mBps.toFixed(2)} MB/s <span style="font-size:0.75rem; color:var(--text-muted);">(${mbps.toFixed(1)}M)</span>`;
            }

            let bufferWarning = "";
            // 仅在产生有效抖动数据或探针检测到中间代理缓冲时展示高抖动劫持预警
            if (isAvail && (m.jitter_ms > 150.0 || (m.proxy_buffer_detected && m.jitter_ms > 5.0))) {
                bufferWarning = `<span class="buffer-warning">${t("table.buffer_warning", {}, "⚠️ Buffer Hijack (High Jitter)")}</span>`;
            }
            if (bufferWarning) {
                jitter += ` ${bufferWarning}`;
            }

            const scoreClass = getScoreLevelClass(m.score);
            scoreHtml = `<span class="score-box ${scoreClass}">${m.score.toFixed(1)}</span>`;
            const apLabel = airportName || t("history.default_airport", {}, "Default");
            const timeLabel = m.tested_time_display || t("table.latest", {}, "Latest");
            tr.title = `${t("table.col_airport", {}, "Airport")}: ${apLabel} | ${t("table.col_node_name", {}, "Node")}: ${node.name} | AIOffer: ${m.ai_offer || activeService} | ${t("table.test_time", {}, "Tested")}: ${timeLabel}`;
        } else {
            const apLabel = airportName || t("history.default_airport", {}, "Default");
            tr.title = `${t("table.col_airport", {}, "Airport")}: ${apLabel} | ${t("table.col_node_name", {}, "Node")}: ${node.name} | ${t("table.status_untested", {}, "Untested")} ${activeService}`;
        }

        const airportTag = airportName
            ? `<span class="airport-tag">${escapeHtml(airportName)}</span>`
            : `<span style="color:var(--text-muted); font-size:0.75rem;">-</span>`;

        tr.innerHTML = `
            <td style="text-align: center;">${rankHtml}</td>
            <td title="${escapeHtml(airportName)}">${airportTag}</td>
            <td style="font-weight: 600;" title="${escapeHtml(node.name)}"><span class="cell-ellipsis-text">${escapeHtml(node.name)}</span></td>
            <td style="text-align: center;">${pingHtml}</td>
            <td>${statusHtml}</td>
            <td>${ttfb}</td>
            <td>${ttft}</td>
            <td>${tps}</td>
            <td>${jitter}</td>
            <td>${bwStr}</td>
            <td class="score-cell">${scoreHtml}</td>
        `;

        tableBody.appendChild(tr);
    });

    // 重新应用各数据列宽度拖拽状态与偏好持久化设置
    const table = document.getElementById("benchmark-table");
    if (table) {
        applyTableColumnWidths(table, "nodepilot_col_widths_benchmark", BENCHMARK_COL_CONFIGS);
    }
}
