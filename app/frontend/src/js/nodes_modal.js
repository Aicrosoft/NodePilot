/**
 * nodes_modal.js
 * 节点详情抽屉列表模态弹窗：指标展示、多维表头排序、及格分自动勾选与测试节点载入。
 */

import { escapeHtml, showToast, extractMetrics, getScoreLevelClass } from "./utils.js";
import {
    initTableColumnResizer,
    applyTableColumnWidths,
    NODES_COL_CONFIGS
} from "./table_resizer.js";
import { openExportModal, initExportModalEvents } from "./vpn_exporter.js";
import { t, onLanguageChange } from "./i18n/i18n.js";

let currentViewingNodes = [];
let currentViewingAirport = null;
let currentFilteredNodes = [];
let onApplyNodesCallback = null;
let closeTimer = null;

// 节点唯一键集合与勾选状态管理
const selectedNodeKeys = new Set();
const SCORE_THRESHOLD = 60.0; // 节点及格基准分：低于 60 分的节点（未及格/劣质/不可用）在测试后默认不自动勾选

// 排序字段与顺序状态控制（默认按综合评分降序）
let sortField = "score";
let sortOrder = "desc";

/**
 * 获取节点的全局唯一标识键名。
 * @param {Object} node - 节点对象
 * @returns {string} 唯一标识键
 */
function getNodeKey(node) {
    if (!node) return "";
    return `${node.airportName || ""}__${node.server || ""}__${node.port || ""}__${node.name || ""}`;
}

/**
 * 初始化节点详情抽屉弹窗的各交互事件监听器。
 * @param {Function} onApplyNodes - 载入选中的节点参与测速时的业务回调函数
 */
export function initNodesModal(onApplyNodes) {
    onApplyNodesCallback = onApplyNodes;

    const modalNodes = document.getElementById("modal-nodes");
    const modalNodesBackdrop = document.getElementById("modal-nodes-backdrop");
    const modalNodesClose = document.getElementById("modal-nodes-close");
    const modalNodesOk = document.getElementById("modal-nodes-ok");
    const modalNodesApply = document.getElementById("modal-nodes-apply");
    const nodeFilterInput = document.getElementById("node-filter-input");
    const selectAllCb = document.getElementById("nodes-select-all");
    const btnExportNodes = document.getElementById("btn-export-nodes");

    if (modalNodesClose) modalNodesClose.addEventListener("click", closeNodesListModal);
    if (modalNodesOk) modalNodesOk.addEventListener("click", closeNodesListModal);
    if (modalNodesBackdrop) modalNodesBackdrop.addEventListener("click", closeNodesListModal);

    // ESC 快捷键平滑关闭抽屉
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const el = document.getElementById("modal-nodes");
            if (el && el.classList.contains("drawer-open")) {
                closeNodesListModal();
            }
        }
    });

    // 关键字过滤搜索输入框
    if (nodeFilterInput) {
        nodeFilterInput.addEventListener("input", (e) => {
            renderNodesList(e.target.value.trim().toLowerCase());
        });
    }

    // 全选 / 取消全选复选框
    if (selectAllCb) {
        selectAllCb.addEventListener("change", () => {
            const isChecked = selectAllCb.checked;
            currentFilteredNodes.forEach(node => {
                const key = getNodeKey(node);
                if (isChecked) {
                    selectedNodeKeys.add(key);
                } else {
                    selectedNodeKeys.delete(key);
                }
            });
            updateSelectionState();
            document.querySelectorAll(".node-select-cb").forEach(cb => {
                cb.checked = isChecked;
            });
        });
    }

    // 将勾选项载入为当前待测节点
    if (modalNodesApply) {
        modalNodesApply.addEventListener("click", () => {
            const selectedNodes = currentViewingNodes.filter(n => selectedNodeKeys.has(getNodeKey(n)));
            if (selectedNodes.length === 0) {
                alert(t("nodes_modal.alert_no_selection", {}, "No nodes selected. Please select at least one node!"));
                return;
            }
            if (typeof onApplyNodesCallback === "function") {
                onApplyNodesCallback(currentViewingAirport, selectedNodes);
            }
            closeNodesListModal();
            const modalAirports = document.getElementById("modal-airports");
            if (modalAirports) modalAirports.classList.add("hidden");
            showToast(t("nodes_modal.toast_loaded", { count: selectedNodes.length }, `⚡ Loaded ${selectedNodes.length} selected nodes for benchmark!`));
        });
    }

    // 批量导出选中的节点
    if (btnExportNodes) {
        btnExportNodes.addEventListener("click", () => {
            const selectedNodes = currentViewingNodes.filter(n => selectedNodeKeys.has(getNodeKey(n)));
            if (selectedNodes.length === 0) {
                alert(t("nodes_modal.alert_no_selection_export", {}, "No nodes selected. Please select at least one valid node before exporting!"));
                return;
            }
            openExportModal(selectedNodes, currentViewingAirport ? currentViewingAirport.name : "NodePilot");
        });
    }

    // 表头各列排序点击事件
    const sortableHeaders = document.querySelectorAll("#modal-nodes-table th.sortable-th");
    sortableHeaders.forEach(th => {
        th.addEventListener("click", (e) => {
            if (e.target.closest(".info-icon") || e.target.closest(".col-resizer") || e.target.closest("input")) {
                return;
            }
            const field = th.getAttribute("data-sort");
            if (!field) return;

            if (sortField === field) {
                sortOrder = (sortOrder === "desc" ? "asc" : "desc");
            } else {
                sortField = field;
                if (["score", "tps", "ingress", "time"].includes(field)) {
                    sortOrder = "desc";
                } else {
                    sortOrder = "asc";
                }
            }

            const kw = nodeFilterInput ? nodeFilterInput.value.trim().toLowerCase() : "";
            renderNodesList(kw);
        });
    });

    // 复选框事件委托代理
    const nodesListBody = document.getElementById("nodes-list-body");
    if (nodesListBody) {
        nodesListBody.addEventListener("change", (e) => {
            if (e.target.classList.contains("node-select-cb")) {
                const key = e.target.getAttribute("data-node-key");
                if (key) {
                    if (e.target.checked) {
                        selectedNodeKeys.add(key);
                    } else {
                        selectedNodeKeys.delete(key);
                    }
                    updateSelectionState();
                }
            }
        });
    }

    // 初始化导出弹窗相关选项卡与事件
    initExportModalEvents();

    // 初始化表格列宽拖拽调整与持久化
    const nodesTable = document.getElementById("modal-nodes-table");
    if (nodesTable) {
        initTableColumnResizer(nodesTable, "nodepilot_col_widths_nodes", NODES_COL_CONFIGS);
    }
}

/**
 * 打开节点列表侧滑抽屉并初始化勾选状态。
 * @param {Array} nodes - 待展示的节点数组
 * @param {string} title - 抽屉标题文本
 * @param {Object} airport - 所属机场对象
 */
let lastModalTitle = "";
export function openNodesListModal(nodes, title = "", airport = null) {
    currentViewingNodes = (nodes || []).map((n, idx) => ({ ...n, _origIdx: idx }));
    currentViewingAirport = airport;

    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    // 及格分自动勾选判定逻辑：
    selectedNodeKeys.clear();
    const anyTested = currentViewingNodes.some(n => {
        const rawBm = n.latestBenchmark || (n.benchmarkResults && Object.keys(n.benchmarkResults).length > 0);
        return Boolean(rawBm);
    });

    if (anyTested) {
        currentViewingNodes.forEach(n => {
            const rawBm = n.latestBenchmark || (n.benchmarkResults ? Object.values(n.benchmarkResults)[0] : null);
            if (rawBm) {
                const bm = extractMetrics(rawBm);
                const isPass = bm.score >= SCORE_THRESHOLD && (bm.status === "Available" || bm.status === "Authentication Required");
                if (isPass) {
                    selectedNodeKeys.add(getNodeKey(n));
                }
            }
        });
    } else {
        currentViewingNodes.forEach(n => selectedNodeKeys.add(getNodeKey(n)));
    }

    sortField = "score";
    sortOrder = "desc";

    const modalNodes = document.getElementById("modal-nodes");
    const modalNodesTitle = document.getElementById("modal-nodes-title");
    const nodeFilterInput = document.getElementById("node-filter-input");

    lastModalTitle = title || t("nodes_modal.title_default", {}, "📋 Node Details List");
    if (nodeFilterInput) nodeFilterInput.value = "";
    if (modalNodesTitle) modalNodesTitle.innerText = t("nodes_modal.title_with_count", { title: lastModalTitle, count: currentViewingNodes.length }, `${lastModalTitle} (${currentViewingNodes.length})`);

    renderNodesList("");
    if (modalNodes) {
        modalNodes.classList.remove("hidden");
        requestAnimationFrame(() => {
            modalNodes.classList.add("drawer-open");
        });
    }
}

/**
 * 平滑关闭节点详情抽屉弹窗。
 */
export function closeNodesListModal() {
    const modalNodes = document.getElementById("modal-nodes");
    if (modalNodes) {
        modalNodes.classList.remove("drawer-open");
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            modalNodes.classList.add("hidden");
            closeTimer = null;
        }, 280);
    }
}

/**
 * 更新全选复选框的状态（半选/全选/未选）及已选数量统计。
 */
function updateSelectionState() {
    const selectAllCb = document.getElementById("nodes-select-all");
    const countEl = document.getElementById("nodes-selected-count");

    let selectedVisible = 0;
    currentFilteredNodes.forEach(node => {
        if (selectedNodeKeys.has(getNodeKey(node))) {
            selectedVisible++;
        }
    });

    const totalSelected = selectedNodeKeys.size;
    if (countEl) {
        countEl.innerText = t("nodes_modal.count_selected", { selected: totalSelected, total: currentViewingNodes.length }, `Selected: ${totalSelected} / ${currentViewingNodes.length}`);
    }

    if (selectAllCb) {
        if (currentFilteredNodes.length === 0) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        } else if (selectedVisible === currentFilteredNodes.length) {
            selectAllCb.checked = true;
            selectAllCb.indeterminate = false;
        } else if (selectedVisible > 0) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = true;
        } else {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        }
    }
}

/**
 * 渲染抽屉内的节点列表表格内容。
 * @param {string} filterText - 搜索关键字
 */
export function renderNodesList(filterText = "") {
    const nodesListBody = document.getElementById("nodes-list-body");
    const nodesFilterCount = document.getElementById("nodes-filter-count");
    if (!nodesListBody) return;

    nodesListBody.innerHTML = "";

    if (!currentViewingNodes || currentViewingNodes.length === 0) {
        nodesListBody.innerHTML = `<tr><td colspan="14" style="text-align:center; color: var(--text-muted); padding: 24px;">${t("nodes_modal.empty_nodes", {}, "No nodes to display")}</td></tr>`;
        if (nodesFilterCount) nodesFilterCount.innerText = t("nodes_modal.count_total", { count: 0 }, "Total 0 nodes");
        updateSelectionState();
        return;
    }

    // 1. 关键字过滤
    let filtered = currentViewingNodes.filter(node => {
        if (!filterText) return true;
        const name = (node.name || "").toLowerCase();
        const type = (node.type || "").toLowerCase();
        const server = (node.server || "").toLowerCase();
        const port = String(node.port || "");
        const apName = (node.airportName || "").toLowerCase();
        return name.includes(filterText) || type.includes(filterText) || server.includes(filterText) || port.includes(filterText) || apName.includes(filterText);
    });

    currentFilteredNodes = filtered;

    if (nodesFilterCount) {
        nodesFilterCount.innerText = t("nodes_modal.count_filter", { shown: filtered.length, total: currentViewingNodes.length }, `Showing ${filtered.length} / ${currentViewingNodes.length} nodes`);
    }

    if (filtered.length === 0) {
        nodesListBody.innerHTML = `<tr><td colspan="14" style="text-align:center; color: var(--text-muted); padding: 20px;">${t("nodes_modal.no_matching", { filter: escapeHtml(filterText) }, `No nodes matching "${escapeHtml(filterText)}"`)}</td></tr>`;
        updateSelectionState();
        return;
    }

    // 2. 多维度动态排序
    filtered.sort((a, b) => {
        const rawA = a.latestBenchmark || (a.benchmarkResults ? Object.values(a.benchmarkResults)[0] : null);
        const rawB = b.latestBenchmark || (b.benchmarkResults ? Object.values(b.benchmarkResults)[0] : null);
        const mA = rawA ? extractMetrics(rawA) : {};
        const mB = rawB ? extractMetrics(rawB) : {};

        let res = 0;
        switch (sortField) {
            case "score":
                res = (mA.score || 0) - (mB.score || 0);
                break;
            case "availability":
                const rankStatus = (s) => (s === "Available" ? 4 : s === "Authentication Required" ? 3 : s === "Restricted" ? 2 : s === "Timeout" ? 1 : 0);
                res = rankStatus(mA.status) - rankStatus(mB.status);
                break;
            case "ttfb":
                const ttfbA = (mA.ttfb_ms && mA.ttfb_ms > 0) ? mA.ttfb_ms : 999999;
                const ttfbB = (mB.ttfb_ms && mB.ttfb_ms > 0) ? mB.ttfb_ms : 999999;
                res = ttfbA - ttfbB;
                break;
            case "ttft":
                const ttftA = (mA.ttft_ms && mA.ttft_ms > 0) ? mA.ttft_ms : 999999;
                const ttftB = (mB.ttft_ms && mB.ttft_ms > 0) ? mB.ttft_ms : 999999;
                res = ttftA - ttftB;
                break;
            case "tps":
                res = (mA.tps || 0) - (mB.tps || 0);
                break;
            case "jitter":
                const jA = (mA.jitter_ms && mA.jitter_ms > 0) ? mA.jitter_ms : 999999;
                const jB = (mB.jitter_ms && mB.jitter_ms > 0) ? mB.jitter_ms : 999999;
                res = jA - jB;
                break;
            case "ingress":
                res = (mA.ingress_bps || 0) - (mB.ingress_bps || 0);
                break;
            case "time":
                const tA = mA.tested_at ? new Date(mA.tested_at).getTime() : 0;
                const tB = mB.tested_at ? new Date(mB.tested_at).getTime() : 0;
                res = tA - tB;
                break;
            case "name":
                res = (a.name || "").localeCompare(b.name || "");
                break;
            case "type":
                res = (a.type || "").localeCompare(b.type || "");
                break;
            case "server":
                res = (a.server || "").localeCompare(b.server || "");
                break;
            case "index":
            default:
                res = (a._origIdx || 0) - (b._origIdx || 0);
                break;
        }
        return sortOrder === "desc" ? -res : res;
    });

    // 3. 更新表头排序指示箭头 (▲ / ▼)
    document.querySelectorAll("#modal-nodes-table th.sortable-th").forEach(th => {
        const field = th.getAttribute("data-sort");
        const ind = th.querySelector(".sort-indicator");
        if (ind) {
            if (field === sortField) {
                ind.innerText = (sortOrder === "asc" ? " ▲" : " ▼");
            } else {
                ind.innerText = "";
            }
        }
    });

    // 4. 生成数据行 DOM 节点
    filtered.forEach((node, index) => {
        const tr = document.createElement("tr");
        const apTag = node.airportName ? `<span class="airport-tag">${escapeHtml(node.airportName)}</span>` : "";
        const nodeKey = getNodeKey(node);
        const isChecked = selectedNodeKeys.has(nodeKey);

        let scoreHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let availHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">${t("nodes_modal.status_untested", {}, "Untested")}</span>`;
        let pingHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let ttfbHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let ttftHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let tpsHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let jitterHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let ingressHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        let timeHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;

        const rawBm = node.latestBenchmark || (node.benchmarkResults ? Object.values(node.benchmarkResults)[0] : null);
        if (rawBm) {
            const bm = extractMetrics(rawBm);
            const scoreVal = bm.score > 0 ? bm.score.toFixed(1) : "0.0";
            const scoreClass = getScoreLevelClass(bm.score);
            scoreHtml = `<span class="score-box ${scoreClass}">${scoreVal}</span>`;

            // 节点 Ping
            const pingMs = bm.ping_ms || (typeof rawBm.ping_ms === "number" ? rawBm.ping_ms : 0);
            const pingStatus = bm.ping_status || rawBm.ping_status || "";
            if (pingStatus === "ok" || pingMs > 0) {
                let pingClass = "ping-fast";
                if (pingMs > 300) pingClass = "ping-slow";
                else if (pingMs > 150) pingClass = "ping-medium";
                pingHtml = `<span class="ping-badge ${pingClass}" title="${t("nodes_modal.ping_tip", { ms: pingMs }, `Node handshake latency: ${pingMs}ms`)}">⚡ ${pingMs}ms</span>`;
            } else if (pingStatus === "unreachable" || rawBm.status === "Unavailable" || rawBm.status === "Timeout") {
                const failTip = rawBm.error_msg ? `title="${t("nodes_modal.ping_fail_tip", { error: escapeHtml(rawBm.error_msg) }, `❌ Node connection failed:\n${escapeHtml(rawBm.error_msg)}`)}"` : `title="${t("nodes_modal.ping_offline_tip", {}, "❌ Node offline unreachable")}"`;
                pingHtml = `<span class="ping-badge ping-fail" ${failTip} style="cursor:help;">${t("table.ping_unreachable", {}, "❌ Offline")}</span>`;
            } else if (pingStatus === "skipped") {
                pingHtml = `<span style="color:var(--text-muted); font-size:0.75rem;">${t("table.ping_skipped", {}, "Skipped")}</span>`;
            }

            const isAvail = (bm.status === "Available" || bm.status === "Authentication Required");
            const statusClass = isAvail ? "status-avail" : "status-unavail";
            const errTip = rawBm.error_msg ? `title="${t("nodes_modal.fail_reason_tip", { error: escapeHtml(rawBm.error_msg) }, `❌ Failure reason:\n${escapeHtml(rawBm.error_msg)}`)}"` : `title="${t("nodes_modal.service_status_tip", { status: bm.status || 'Available' }, `Service status: ${bm.status || 'Available'}`)}"`;
            availHtml = `<span class="status-pill ${statusClass}" ${errTip} style="cursor: ${rawBm.error_msg ? 'help' : 'default'};">${bm.status || (isAvail ? "Available" : "Unavailable")}</span>`;

            ttfbHtml = bm.ttfb_ms > 0 ? `<span class="val-mono">${bm.ttfb_ms}ms</span>` : (isAvail ? `<span class="val-mono" style="color:var(--text-muted);">&lt; 1ms</span>` : `-`);
            ttftHtml = bm.ttft_ms > 0 ? `<span class="val-mono">${bm.ttft_ms}ms</span>` : (isAvail ? `<span class="val-mono" style="color:var(--text-muted);">&lt; 1ms</span>` : `-`);
            tpsHtml = bm.tps > 0 ? `<span class="val-mono">${bm.tps.toFixed(1)}</span>` : (isAvail ? `<span class="val-mono" style="color:var(--text-muted);">N/A</span>` : `-`);
            
            let jitterWarning = "";
            if (bm.proxy_buffer_detected && bm.jitter_ms > 5.0) {
                jitterWarning = `<div class="proxy-buffering-warn" style="font-size:0.68rem; color:var(--accent-red);" title="${t("nodes_modal.buffering_tip", {}, "Detected Proxy Buffering hijack")}">${t("nodes_modal.buffering_warn", {}, "⚠️ Buffer Hijack")}</div>`;
            }
            jitterHtml = bm.jitter_ms > 0.05 ? `<span class="val-mono">${bm.jitter_ms.toFixed(1)}ms</span>${jitterWarning}` : (isAvail ? `<span class="val-mono" style="color:var(--text-muted);">N/A</span>` : `-`);

            if (bm.ingress_bps > 0) {
                const mbps = (bm.ingress_bps * 8) / (1024 * 1024);
                ingressHtml = `<span class="val-mono">${mbps.toFixed(2)} MB/s</span>`;
            } else {
                ingressHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
            }

            timeHtml = bm.tested_time_display 
                ? `<span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace;">${escapeHtml(bm.tested_time_display)}</span>`
                : `<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>`;
        }

        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="node-select-cb" data-node-key="${escapeHtml(nodeKey)}" ${isChecked ? "checked" : ""} style="cursor: pointer;" title="${t("nodes_modal.cb_title", {}, "Select / deselect this node")}" />
            </td>
            <td style="color: var(--text-secondary); font-size: 0.75rem; text-align: center;">${index + 1}</td>
            <td style="font-weight: 600; color: var(--text-primary);" title="${escapeHtml(node.name)}"><span class="cell-ellipsis-text">${apTag}${escapeHtml(node.name)}</span></td>
            <td style="text-align: center;" title="${escapeHtml(node.type || 'unknown')}"><span class="type-tag">${escapeHtml(node.type || "unknown")}</span></td>
            <td style="font-family: monospace; font-size: 0.78rem; color: var(--text-secondary);" title="${escapeHtml(node.server)}:${node.port}"><span class="cell-ellipsis-text">${escapeHtml(node.server)}:${node.port}</span></td>
            <td style="text-align: center;">${pingHtml}</td>
            <td style="text-align: center;">${scoreHtml}</td>
            <td style="text-align: center;">${availHtml}</td>
            <td style="text-align: center;">${ttfbHtml}</td>
            <td style="text-align: center;">${ttftHtml}</td>
            <td style="text-align: center;">${tpsHtml}</td>
            <td style="text-align: center;">${jitterHtml}</td>
            <td style="text-align: center;">${ingressHtml}</td>
            <td style="text-align: center;">${timeHtml}</td>
        `;
        nodesListBody.appendChild(tr);
    });

    updateSelectionState();

    // 动态应用列宽
    const table = document.getElementById("modal-nodes-table");
    if (table) {
        applyTableColumnWidths(table, "nodepilot_col_widths_nodes", NODES_COL_CONFIGS);
    }
}

// 注册全局语言切换动态刷新监听器
onLanguageChange(() => {
    if (currentViewingNodes && currentViewingNodes.length > 0) {
        const modalNodesTitle = document.getElementById("modal-nodes-title");
        if (modalNodesTitle && lastModalTitle) {
            modalNodesTitle.innerText = t("nodes_modal.title_with_count", { title: lastModalTitle, count: currentViewingNodes.length }, `${lastModalTitle} (${currentViewingNodes.length})`);
        }
        renderNodesList(document.getElementById("node-filter-input")?.value || "");
    }
});
