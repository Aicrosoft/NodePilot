/**
 * history_chart.js
 * 历史基准测试多维时序趋势图模块（基于原生 SVG 渲染，支持双 Y 轴、指标多选互斥、极性方向徽章与三次贝塞尔平滑曲线）
 */

import { escapeHtml, formatFullDateTime } from "./utils.js";
import { t } from "./i18n/i18n.js";

// 核心指标语义基准色板（单实体多指标展示时优先采用）
const METRIC_SEMANTIC_COLORS = {
    score: "#10b981", // 翡翠绿（综合评分）
    ping: "#0ea5e9", // 天空蓝（节点 Ping）
    ttft: "#8b5cf6", // 极光紫（首字时延 TTFT）
    tps: "#f59e0b", // 琥珀金（流式 TPS）
    ttfb: "#ec4899"  // 珊瑚粉（连接建立 TTFB）
};

// 调色板：高对比度、无障碍、易区分的多维色彩矩阵
const COLOR_PALETTE = [
    "#10b981", // 翡翠绿
    "#0ea5e9", // 天空蓝
    "#8b5cf6", // 紫罗兰
    "#f59e0b", // 琥珀金
    "#ec4899", // 珊瑚粉
    "#06b6d4", // 青碧
    "#6366f1", // 靛蓝
    "#14b8a6", // 蓝绿
    "#f97316", // 橙色
    "#a855f7", // 浅紫
    "#84cc16", // 青柠
    "#3b82f6", // 宝蓝
    "#d946ef", // 洋红
    "#eab308", // 黄色
    "#2dd4bf", // 薄荷绿
    "#fb7185", // 玫瑰粉
    "#38bdf8", // 亮蓝
    "#a78bfa"  // 薰衣草紫
];

export const METRIC_GROUPS = {
    higher: {
        key: "higher",
        nameKey: "history.group_higher",
        defaultName: "📈 质量与吞吐组 (越高越好)",
        badgeKey: "history.dir_tag_higher",
        defaultBadge: "↑ 优",
        higherIsBetter: true
    },
    lower: {
        key: "lower",
        nameKey: "history.group_lower",
        defaultName: "⚡ 时延与网络组 (越低越好 · 毫秒)",
        badgeKey: "history.dir_tag_lower",
        defaultBadge: "↓ 优",
        higherIsBetter: false
    }
};

export const METRICS_CONFIG = [
    { key: "score", group: "higher", nameKey: "history.metric_score", shortNameKey: "history.short_metric_score", defaultName: "🏆 Score (0~100)", shortName: "Score", icon: "🏆", unit: "pts", higherIsBetter: true, fixedMin: 0, fixedMax: 100 },
    { key: "tps", group: "higher", nameKey: "history.metric_tps", shortNameKey: "history.short_metric_tps", defaultName: "🚀 Stream TPS (tokens/s)", shortName: "TPS", icon: "🚀", unit: "TPS", higherIsBetter: true },
    { key: "ping", group: "lower", nameKey: "history.metric_ping", shortNameKey: "history.short_metric_ping", defaultName: "⚡ Node Ping (ms)", shortName: "Ping", icon: "⚡", unit: "ms", higherIsBetter: false },
    { key: "ttft", group: "lower", nameKey: "history.metric_ttft", shortNameKey: "history.short_metric_ttft", defaultName: "⏱️ TTFT Latency (ms)", shortName: "TTFT", icon: "⏱️", unit: "ms", higherIsBetter: false },
    { key: "ttfb", group: "lower", nameKey: "history.metric_ttfb", shortNameKey: "history.short_metric_ttfb", defaultName: "🌐 Connect TTFB (ms)", shortName: "TTFB", icon: "🌐", unit: "ms", higherIsBetter: false }
];

export function getMetricShortName(m) {
    if (!m) return "";
    return t(m.shortNameKey, {}, m.shortName);
}

/**
 * 纯函数：根据极性分组与互斥规则更新当前选中的指标集合。
 * - 同一极性分组内的指标支持多选（上限 2 项，以保证图表轴线与双 Y 轴可读性）。
 * - 选择不同极性分组的指标时，立即清空旧分组并切换至新指标组。
 * - 确保至少保留一项激活指标（不可取消勾选最后一项）。
 *
 * @param {Array<string>} currentMetrics - 当前激活的指标键名数组
 * @param {string} targetKey - 当前被点击切换的目标指标键名
 * @param {boolean} isChecked - 目标复选框当前是否被勾选
 * @returns {Array<string>} 更新后的激活指标键名数组
 */
export function updateMetricSelection(currentMetrics, targetKey, isChecked) {
    const targetConfig = METRICS_CONFIG.find(m => m.key === targetKey);
    if (!targetConfig) return currentMetrics || ["score"];

    const activeList = Array.isArray(currentMetrics) ? [...currentMetrics] : ["score"];
    const currentConfigs = METRICS_CONFIG.filter(m => activeList.includes(m.key));
    const currentGroup = currentConfigs.length > 0 ? currentConfigs[0].group : "higher";

    if (isChecked) {
        // 跨组切换：立即清空并隔离至全新极性组
        if (targetConfig.group !== currentGroup) {
            return [targetKey];
        }

        // 同组新增：若未包含则追加，最多容纳 2 个指标（滑动窗口更新）
        if (!activeList.includes(targetKey)) {
            if (activeList.length >= 2) {
                // 保留最近加入的 2 个指标
                return [activeList[activeList.length - 1], targetKey];
            }
            return [...activeList, targetKey];
        }
        return activeList;
    } else {
        // 取消勾选：同组内至少保留 1 个指标
        if (activeList.length > 1) {
            return activeList.filter(k => k !== targetKey);
        }
        // 保持最后一项不被取消
        return activeList;
    }
}

let activeGroupBy = "airport";     // 分组维度："airport" | "node" | "service"
let activeMetrics = ["score"];     // 多维指标，默认综合评分
let activeTimeMode = "raw";        // 时间对齐模式：默认按节点测试完成时间（"raw"）| 按批次对齐（"batch"）
let activeAirportFilter = "all";    // 机场过滤："all" | 具体机场名称
let activeScoreFilter = "all";      // 评分门槛过滤："all" | "0" | "30" | "60" | "80"
let hiddenSeriesKeys = new Set();  // 临时静音隐藏的系列集合
let removedSeriesKeys = new Set(); // 手动排除移除的系列集合
let cachedRecords = [];            // 缓存的历史记录列表
let resizeHandlerAttached = false; // 窗口尺寸监听器是否已挂载

/**
 * 初始化图表事件与窗口重绘监听器
 */
export function initHistoryChart() {
    if (!resizeHandlerAttached) {
        window.addEventListener("resize", () => {
            if (cachedRecords && cachedRecords.length > 0) {
                const container = document.getElementById("history-chart-canvas-container");
                if (container && container.offsetParent !== null) {
                    renderSvgChart();
                }
            }
        });
        // Collapse metric multi-select dropdown when clicking outside
        document.addEventListener("click", (e) => {
            const dropdown = document.getElementById("history-metric-dropdown");
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove("open");
                const panel = document.getElementById("history-metric-dropdown-panel");
                if (panel) panel.classList.add("hidden");
            }
        });
        resizeHandlerAttached = true;
    }
}

/**
 * 外部渲染入口：绘制基准测试历史趋势分析面板
 * @param {Array<Object>} records - 全量历史基准测试记录集合
 */
export function renderHistoryChart(records = []) {
    cachedRecords = Array.isArray(records) ? records : [];
    const container = document.getElementById("history-chart-mount");
    if (!container) return;

    if (!cachedRecords || cachedRecords.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 50px 20px;">
                <div style="font-size: 2.2rem; margin-bottom: 12px;">📊</div>
                <div style="font-size: 1rem; font-weight: 500; color: var(--text-secondary);">
                    ${t("history.empty_title", {}, "No benchmark records yet")}
                </div>
                <p style="font-size: 0.85rem; margin-top: 6px;">
                    ${t("history.empty_desc", {}, "Benchmark results will be automatically archived here after running a test")}
                </p>
            </div>
        `;
        return;
    }

    // 提取所有涉及的机场名称（用于填充机场筛选下拉列表）
    const defaultAirportName = t("history.default_airport", {}, "Default");
    const airportNames = Array.from(new Set(cachedRecords.map(r => r.airport_name || defaultAirportName))).filter(Boolean);

    // 构建图表外层容器骨架 HTML
    container.innerHTML = `
        <div class="history-chart-wrapper">
            <!-- 顶部控制工具栏 -->
            <div class="history-chart-toolbar">
                <div class="history-chart-controls-left">
                    <div class="history-chart-control-group">
                        <label class="history-chart-label" data-i18n="history.group_by">${t("history.group_by", {}, "Group By:")}</label>
                        <select id="history-chart-group-by" class="history-chart-select">
                            <option value="airport" ${activeGroupBy === "airport" ? "selected" : ""}>${t("history.group_airport", {}, "🏢 By Airport")}</option>
                            <option value="node" ${activeGroupBy === "node" ? "selected" : ""}>${t("history.group_node", {}, "🚀 By Node")}</option>
                            <option value="service" ${activeGroupBy === "service" ? "selected" : ""}>${t("history.group_service", {}, "🤖 By AI Service")}</option>
                        </select>
                    </div>

                    <!-- 指标维度多选下拉面板 -->
                    <div class="history-chart-control-group">
                        <label class="history-chart-label" data-i18n="history.metric">${t("history.metric", {}, "Metric:")}</label>
                        <div class="history-metric-dropdown" id="history-metric-dropdown">
                            <button type="button" class="history-metric-trigger-btn" id="history-metric-trigger-btn">
                                <span id="history-metric-trigger-text">${getMetricTriggerText()}</span>
                                <span class="history-metric-trigger-arrow">▾</span>
                            </button>
                            <div class="history-metric-dropdown-panel hidden" id="history-metric-dropdown-panel">
                                <!-- 分组 1：质量与吞吐组 (越高越好) -->
                                <div class="history-metric-group-section" data-group="higher">
                                    <div class="history-metric-group-header">
                                        <span class="history-metric-group-title" data-i18n="history.group_higher">${t("history.group_higher", {}, "📈 质量与吞吐组 (越高越好)")}</span>
                                        <span class="history-metric-group-badge higher" data-i18n="history.dir_tag_higher">${t("history.dir_tag_higher", {}, "↑ 优")}</span>
                                    </div>
                                    <div class="history-metric-group-items">
                                        ${METRICS_CONFIG.filter(m => m.group === "higher").map(m => {
        const isChecked = activeMetrics.includes(m.key);
        const displayName = t(m.nameKey, {}, m.defaultName);
        return `
                                            <label class="history-metric-item ${isChecked ? "active" : ""}">
                                                <input type="checkbox" class="history-metric-checkbox" data-metric-key="${m.key}" data-metric-group="higher" ${isChecked ? "checked" : ""} />
                                                <span class="history-metric-name">${escapeHtml(displayName)}</span>
                                            </label>
                                        `;
    }).join("")}
                                    </div>
                                </div>

                                <div class="history-metric-group-divider"></div>

                                <!-- 分组 2：时延与网络组 (越低越好 · 毫秒) -->
                                <div class="history-metric-group-section" data-group="lower">
                                    <div class="history-metric-group-header">
                                        <span class="history-metric-group-title" data-i18n="history.group_lower">${t("history.group_lower", {}, "⚡ 时延与网络组 (越低越好 · 毫秒)")}</span>
                                        <span class="history-metric-group-badge lower" data-i18n="history.dir_tag_lower">${t("history.dir_tag_lower", {}, "↓ 优")}</span>
                                    </div>
                                    <div class="history-metric-group-items">
                                        ${METRICS_CONFIG.filter(m => m.group === "lower").map(m => {
        const isChecked = activeMetrics.includes(m.key);
        const displayName = t(m.nameKey, {}, m.defaultName);
        return `
                                            <label class="history-metric-item ${isChecked ? "active" : ""}">
                                                <input type="checkbox" class="history-metric-checkbox" data-metric-key="${m.key}" data-metric-group="lower" ${isChecked ? "checked" : ""} />
                                                <span class="history-metric-name">${escapeHtml(displayName)}</span>
                                            </label>
                                        `;
    }).join("")}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 时间对齐模式（默认：按节点测试完成时间） -->
                    <div class="history-chart-control-group">
                        <label class="history-chart-label" data-i18n="history.time_mode">${t("history.time_mode", {}, "Time Align:")}</label>
                        <select id="history-chart-time-mode" class="history-chart-select">
                            <option value="raw" ${activeTimeMode === "raw" ? "selected" : ""}>${t("history.mode_raw", {}, "📍 By Node Finish Time (Default)")}</option>
                            <option value="batch" ${activeTimeMode === "batch" ? "selected" : ""}>${t("history.mode_batch", {}, "🕒 By Benchmark Batch")}</option>
                        </select>
                    </div>

                    <div class="history-chart-control-group" id="history-chart-airport-filter-group" style="${activeGroupBy === 'node' ? '' : 'display:none;'}">
                        <label class="history-chart-label" data-i18n="history.airport_filter">${t("history.airport_filter", {}, "Airport Filter:")}</label>
                        <select id="history-chart-airport-filter" class="history-chart-select">
                            <option value="all" ${activeAirportFilter === "all" ? "selected" : ""}>${t("history.all_airports", {}, "All Airports")}</option>
                            ${airportNames.map(name => `<option value="${escapeHtml(name)}" ${activeAirportFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
                        </select>
                    </div>

                    <div class="history-chart-control-group" id="history-chart-score-filter-group" style="${activeGroupBy === 'node' ? '' : 'display:none;'}">
                        <label class="history-chart-label" data-i18n="history.score_filter">${t("history.score_filter", {}, "Min Score:")}</label>
                        <select id="history-chart-score-filter" class="history-chart-select">
                            <option value="all" data-i18n="history.score_all" ${activeScoreFilter === "all" ? "selected" : ""}>${t("history.score_all", {}, "All")}</option>
                            <option value="0" data-i18n="history.score_gt0" ${activeScoreFilter === "0" ? "selected" : ""}>${t("history.score_gt0", {}, "> 0 pts (Working Nodes)")}</option>
                            <option value="30" data-i18n="history.score_gte30" ${activeScoreFilter === "30" ? "selected" : ""}>${t("history.score_gte30", {}, "≥ 30 pts")}</option>
                            <option value="60" data-i18n="history.score_gte60" ${activeScoreFilter === "60" ? "selected" : ""}>${t("history.score_gte60", {}, "≥ 60 pts (Good)")}</option>
                            <option value="80" data-i18n="history.score_gte80" ${activeScoreFilter === "80" ? "selected" : ""}>${t("history.score_gte80", {}, "≥ 80 pts (Excellent)")}</option>
                        </select>
                    </div>
                </div>

                <div class="history-chart-summary" id="history-chart-summary"></div>
            </div>

            <!-- 可点击交互图例栏 -->
            <div class="history-chart-legend" id="history-chart-legend" title="${t("history.legend_toggle_tip", {}, "Click legend item to toggle series visibility")}"></div>

            <!-- 核心 SVG 图表画布容器 -->
            <div class="history-chart-canvas-container" id="history-chart-canvas-container">
                <svg id="history-chart-svg" class="history-chart-svg"></svg>
                <div class="history-chart-tooltip" id="history-chart-tooltip"></div>
            </div>
        </div>
    `;

    // 绑定指标多选下拉面板交互事件
    const dropdownWrap = document.getElementById("history-metric-dropdown");
    const triggerBtn = document.getElementById("history-metric-trigger-btn");
    const dropdownPanel = document.getElementById("history-metric-dropdown-panel");
    const triggerText = document.getElementById("history-metric-trigger-text");

    if (triggerBtn && dropdownPanel) {
        triggerBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdownWrap.classList.contains("open");
            if (isOpen) {
                dropdownWrap.classList.remove("open");
                dropdownPanel.classList.add("hidden");
            } else {
                dropdownWrap.classList.add("open");
                dropdownPanel.classList.remove("hidden");
            }
        });

        dropdownPanel.querySelectorAll(".history-metric-checkbox").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const key = chk.getAttribute("data-metric-key");
                activeMetrics = updateMetricSelection(activeMetrics, key, chk.checked);

                // 双向同步两组中的所有复选框与父级激活高亮样式
                dropdownPanel.querySelectorAll(".history-metric-checkbox").forEach(c => {
                    const cKey = c.getAttribute("data-metric-key");
                    const shouldBeChecked = activeMetrics.includes(cKey);
                    c.checked = shouldBeChecked;
                    const parentLabel = c.closest(".history-metric-item");
                    if (parentLabel) {
                        parentLabel.classList.toggle("active", shouldBeChecked);
                    }
                });

                if (triggerText) {
                    triggerText.innerText = getMetricTriggerText();
                }
                renderSvgChart();
            });
        });
    }

    // 绑定其余下拉选择器交互事件
    const selectGroupBy = document.getElementById("history-chart-group-by");
    const selectTimeMode = document.getElementById("history-chart-time-mode");
    const selectAirportFilter = document.getElementById("history-chart-airport-filter");
    const selectScoreFilter = document.getElementById("history-chart-score-filter");
    const filterGroup = document.getElementById("history-chart-airport-filter-group");
    const scoreFilterGroup = document.getElementById("history-chart-score-filter-group");

    if (selectGroupBy) {
        selectGroupBy.addEventListener("change", (e) => {
            activeGroupBy = e.target.value;
            const isNodeMode = (activeGroupBy === "node");
            if (filterGroup) {
                filterGroup.style.display = isNodeMode ? "inline-flex" : "none";
            }
            if (scoreFilterGroup) {
                scoreFilterGroup.style.display = isNodeMode ? "inline-flex" : "none";
            }
            hiddenSeriesKeys.clear();
            removedSeriesKeys.clear();
            renderSvgChart();
        });
    }

    if (selectTimeMode) {
        selectTimeMode.addEventListener("change", (e) => {
            activeTimeMode = e.target.value;
            renderSvgChart();
        });
    }

    if (selectAirportFilter) {
        selectAirportFilter.addEventListener("change", (e) => {
            activeAirportFilter = e.target.value;
            hiddenSeriesKeys.clear();
            removedSeriesKeys.clear();
            renderSvgChart();
        });
    }

    if (selectScoreFilter) {
        selectScoreFilter.addEventListener("change", (e) => {
            activeScoreFilter = e.target.value;
            hiddenSeriesKeys.clear();
            removedSeriesKeys.clear();
            renderSvgChart();
        });
    }

    // 首次初始渲染
    renderSvgChart();
}

/**
 * 获取指标下拉触发按钮的摘要文本
 * @param {Array<string>} [metrics=activeMetrics] - 当前激活的指标键名列表
 * @returns {string} 格式化后的按钮展示文案
 */
export function getMetricTriggerText(metrics = activeMetrics) {
    const list = Array.isArray(metrics) ? metrics : ["score"];
    const activeConfigs = METRICS_CONFIG.filter(m => list.includes(m.key));
    if (activeConfigs.length === 1) {
        const m = activeConfigs[0];
        const dir = m.higherIsBetter ? t("history.dir_higher", {}, "↑ Higher is better") : t("history.dir_lower", {}, "↓ Lower is better");
        return `${m.icon} ${getMetricShortName(m)} (${dir})`;
    } else if (activeConfigs.length >= 2) {
        const first = activeConfigs[0];
        const groupName = first.higherIsBetter
            ? t("history.group_higher_short", {}, "Quality Group")
            : t("history.group_lower_short", {}, "Latency Group");
        const dir = first.higherIsBetter
            ? t("history.dir_higher", {}, "↑ Higher is better")
            : t("history.dir_lower", {}, "↓ Lower is better");
        return `${first.higherIsBetter ? "📈" : "⚡"} ${groupName} (${t("history.metric_multi_selected", { count: activeConfigs.length }, `${activeConfigs.length} Metrics Selected`)} · ${dir})`;
    }
    return t("history.metric", {}, "Metric");
}

/**
 * 将基准测试扁平记录按照批次时间窗口进行聚类整合
 * @param {Array<Object>} records - 原始历史记录列表
 * @returns {Array<Object>} 聚合后的批次会话对象列表
 */
export function clusterIntoBenchmarkSessions(records) {
    if (!records || records.length === 0) return [];

    const sorted = records.slice().sort((a, b) => {
        const ta = new Date(a.batch_time || a.tested_at || a.tested_time_display || 0).getTime() || 0;
        const tb = new Date(b.batch_time || b.tested_at || b.tested_time_display || 0).getTime() || 0;
        return ta - tb;
    });

    const sessions = [];
    let cur = null;
    const SESSION_WINDOW_MS = 120 * 1000;

    sorted.forEach(r => {
        const t = new Date(r.batch_time || r.tested_at || r.tested_time_display || 0).getTime() || 0;
        if (!cur) {
            cur = {
                timestamp: t,
                records: [r],
                sessionKey: r.batch_display || r.tested_time_display || r.tested_at || ""
            };
        } else {
            const lastR = cur.records[cur.records.length - 1];
            const lastT = new Date(lastR.batch_time || lastR.tested_at || lastR.tested_time_display || 0).getTime() || 0;
            const sameExplicitBatch = r.batch_time && lastR.batch_time && r.batch_time === lastR.batch_time;
            if (sameExplicitBatch || (t - lastT <= SESSION_WINDOW_MS)) {
                cur.records.push(r);
            } else {
                sessions.push(cur);
                cur = {
                    timestamp: t,
                    records: [r],
                    sessionKey: r.batch_display || r.tested_time_display || r.tested_at || ""
                };
            }
        }
    });

    if (cur) {
        sessions.push(cur);
    }

    return sessions.map(s => {
        return {
            sessionKey: s.sessionKey,
            timeDisplay: formatShortTime(s.sessionKey),
            timestamp: s.timestamp,
            records: s.records
        };
    });
}

/**
 * 校验指定数值评分是否达到设定的过滤门槛
 * @param {number} score - 待校验的数值评分
 * @param {string} threshold - 过滤门槛配置（"all" | "0" | "30" | "60" | "80"）
 * @returns {boolean} 是否符合门槛要求
 */
export function passesScoreThreshold(score, threshold) {
    if (threshold === "all") return true;
    const num = parseFloat(threshold);
    if (isNaN(num)) return true;
    const s = typeof score === "number" && !isNaN(score) ? score : 0;
    if (num === 0) {
        return s > 0;
    }
    return s >= num;
}

/**
 * 依据分组模式、所属机场及评分门槛精准过滤基准测试历史记录。
 *
 * 评分门槛判定规则：
 * 1. 可用节点 (`> 0 分` / "0"):
 *    只要节点在观测窗口内至少存在一次评分 > 0 的测试记录（即历史最高分 maxScore > 0），即被认定为可用节点；
 *    偶发的网络断连或单次波动掉零不会导致该节点被整体剔除；
 *    仅彻底无法连通（全量测试均为 0 分）的节点会被过滤排除。
 * 2. 优质梯队 (`>= 30`, `>= 60`, `>= 80`):
 *    节点的峰值性能（maxScore）或观测窗口内最近一次有效可用测试评分满足门槛时，判定为达标。
 * 3. 完整时序轨迹保真：
 *    节点一旦被判定入选，保留其在观测窗口内的所有历史采样点（包括掉零记录），以便真实呈现历史波动趋势。
 *
 * @param {Array<Object>} records - 待过滤的历史记录列表
 * @param {Object} [options={}] - 筛选选项对象
 * @param {string} [options.groupBy="node"] - 分组维度："node" | "airport" | "service"
 * @param {string} [options.airportFilter="all"] - 机场筛选："all" 或指定机场名称
 * @param {string} [options.scoreFilter="all"] - 评分门槛："all" | "0" | "30" | "60" | "80"
 * @returns {Array<Object>} 过滤后的基准测试记录数组
 */
export function filterRecords(records, { groupBy = "node", airportFilter = "all", scoreFilter = "all" } = {}) {
    if (!Array.isArray(records) || records.length === 0) return [];

    let filtered = records.slice();

    // 1. 机场层级过滤（在按节点分组模式下生效）
    if (groupBy === "node" && airportFilter && airportFilter !== "all") {
        const defAp = t("history.default_airport", {}, "Default");
        filtered = filtered.filter(r => (r.airport_name || defAp) === airportFilter);
    }

    // 2. 评分门槛过滤（在按节点分组模式下生效）
    if (groupBy === "node" && scoreFilter && scoreFilter !== "all") {
        const nodeStatsMap = new Map();

        filtered.forEach(r => {
            const ap = r.airport_name || t("history.default_airport", {}, "Default");
            const nodeName = r.node_name || r.name || t("history.unknown_node", {}, "Node");
            const nodeKey = `${ap}:::${nodeName}`;

            const rawScore = typeof r.score === "number" && !isNaN(r.score) ? r.score : 0;
            const rawTime = r.batch_time || r.tested_at || r.tested_time_display || "";
            const parseableTime = typeof rawTime === "string" ? rawTime.replace(" ", "T") : rawTime;
            const timestamp = new Date(parseableTime || 0).getTime() || 0;

            let stats = nodeStatsMap.get(nodeKey);
            if (!stats) {
                stats = {
                    nodeKey,
                    maxScore: rawScore,
                    latestTimestamp: timestamp,
                    latestScore: rawScore,
                    latestValidTimestamp: rawScore > 0 ? timestamp : 0,
                    latestValidScore: rawScore > 0 ? rawScore : 0,
                    hasPositiveScore: rawScore > 0
                };
                nodeStatsMap.set(nodeKey, stats);
            } else {
                if (rawScore > stats.maxScore) {
                    stats.maxScore = rawScore;
                }
                if (rawScore > 0) {
                    stats.hasPositiveScore = true;
                    if (timestamp >= stats.latestValidTimestamp) {
                        stats.latestValidTimestamp = timestamp;
                        stats.latestValidScore = rawScore;
                    }
                }
                if (timestamp >= stats.latestTimestamp) {
                    stats.latestTimestamp = timestamp;
                    stats.latestScore = rawScore;
                }
            }
        });

        const qualifiedNodeKeys = new Set();
        nodeStatsMap.forEach((stats, nodeKey) => {
            const repScore = stats.latestValidScore > 0 ? stats.latestValidScore : (stats.maxScore > 0 ? stats.maxScore : stats.latestScore);
            if (passesScoreThreshold(repScore, scoreFilter) || passesScoreThreshold(stats.maxScore, scoreFilter)) {
                qualifiedNodeKeys.add(nodeKey);
            }
        });

        filtered = filtered.filter(r => {
            const ap = r.airport_name || t("history.default_airport", {}, "Default");
            const nodeName = r.node_name || r.name || t("history.unknown_node", {}, "Node");
            const nodeKey = `${ap}:::${nodeName}`;
            return qualifiedNodeKeys.has(nodeKey);
        });
    }

    return filtered;
}

/**
 * 绘制 SVG 曲线与轴线系统（完整支持单/双 Y 轴及多指标对比）
 */
function renderSvgChart() {
    const svg = document.getElementById("history-chart-svg");
    const container = document.getElementById("history-chart-canvas-container");
    const legendContainer = document.getElementById("history-chart-legend");
    const summaryContainer = document.getElementById("history-chart-summary");
    const tooltip = document.getElementById("history-chart-tooltip");
    if (!svg || !container) return;

    // 1. 数据过滤
    let records = filterRecords(cachedRecords, {
        groupBy: activeGroupBy,
        airportFilter: activeAirportFilter,
        scoreFilter: activeScoreFilter
    });

    // 2. 提取时间序列映射表
    const timeMap = new Map();
    const timeLabelMap = new Map();

    if (activeTimeMode === "batch") {
        const sessions = clusterIntoBenchmarkSessions(records);
        sessions.forEach(sess => {
            timeMap.set(sess.sessionKey, sess.records);
            timeLabelMap.set(sess.sessionKey, sess.timeDisplay);
        });
    } else {
        // 默认按节点测试完成时间对齐
        records.forEach(r => {
            const timeKey = r.tested_time_display || r.tested_at || "";
            if (!timeKey) return;
            if (!timeMap.has(timeKey)) {
                timeMap.set(timeKey, []);
            }
            timeMap.get(timeKey).push(r);
            timeLabelMap.set(timeKey, formatShortTime(timeKey));
        });
    }

    // 按时间升序排序时间键
    const sortedTimeKeys = Array.from(timeMap.keys()).sort((a, b) => {
        const da = new Date(a).getTime() || 0;
        const db = new Date(b).getTime() || 0;
        return da - db;
    });

    if (sortedTimeKeys.length === 0) {
        svg.innerHTML = "";
        if (legendContainer) legendContainer.innerHTML = "";
        return;
    }

    // 3. 构建多维指标时间序列映射
    // 建立全局稳定的实体分组色彩映射索引
    const distinctGroupKeys = [];
    records.forEach(r => {
        let gKey = "";
        if (activeGroupBy === "airport") {
            gKey = r.airport_name || t("history.default_airport", {}, "Default");
        } else if (activeGroupBy === "node") {
            const ap = r.airport_name || t("history.default_airport", {}, "Default");
            const nodeName = r.node_name || r.name || t("history.unknown_node", {}, "Node");
            gKey = `${ap}:::${nodeName}`;
        } else if (activeGroupBy === "service") {
            gKey = r.service_name || r.ai_offer || t("history.default_service", {}, "Default Service");
        }
        if (gKey && !distinctGroupKeys.includes(gKey)) {
            distinctGroupKeys.push(gKey);
        }
    });

    // 实体 × 指标矩阵色彩分配算法
    const getMatrixSeriesColor = (gKey, mKey, mIdx) => {
        const groupIdx = distinctGroupKeys.indexOf(gKey);
        const safeGroupIdx = groupIdx >= 0 ? groupIdx : 0;
        const totalGroups = distinctGroupKeys.length;
        const totalMetrics = activeMetricConfigs.length;

        // 场景 1：单实体 × 多指标（采用语义主色方案）
        if (totalGroups <= 1 && totalMetrics > 1) {
            return METRIC_SEMANTIC_COLORS[mKey] || COLOR_PALETTE[mIdx % COLOR_PALETTE.length];
        }

        // 场景 2：多实体 × 单指标（采用实体色板方案）
        if (totalGroups > 1 && totalMetrics <= 1) {
            return COLOR_PALETTE[safeGroupIdx % COLOR_PALETTE.length];
        }

        // 场景 3：多实体 × 多指标（矩阵交织散列分配）
        const matrixIdx = (safeGroupIdx * totalMetrics + mIdx) % COLOR_PALETTE.length;
        return COLOR_PALETTE[matrixIdx];
    };

    // 每个实体分组在各选定指标下独立生成一条时序曲线
    // seriesKey 结构：`${groupKey}:::${metricKey}`
    const seriesMap = new Map();

    // 提取当前选中的指标配置项
    const activeMetricConfigs = METRICS_CONFIG.filter(m => activeMetrics.includes(m.key));
    const isDualAxis = activeMetricConfigs.length >= 2;
    const primaryMetric = activeMetricConfigs[0];
    const secondaryMetric = activeMetricConfigs[1] || primaryMetric;

    sortedTimeKeys.forEach(timeKey => {
        const items = timeMap.get(timeKey);
        const groupItemsMap = new Map();
        items.forEach(item => {
            let key = "";
            let label = "";
            if (activeGroupBy === "airport") {
                key = item.airport_name || t("history.default_airport", {}, "Default");
                label = key;
            } else if (activeGroupBy === "node") {
                const ap = item.airport_name || t("history.default_airport", {}, "Default");
                const nodeName = item.node_name || item.name || t("history.unknown_node", {}, "Node");
                key = `${ap}:::${nodeName}`;
                label = `[${ap}] ${nodeName}`;
            } else if (activeGroupBy === "service") {
                key = item.service_name || item.ai_offer || t("history.default_service", {}, "Default Service");
                label = key;
            }
            if (!groupItemsMap.has(key)) {
                groupItemsMap.set(key, { label, list: [] });
            }
            groupItemsMap.get(key).list.push(item);
        });

        // 计算每个选定指标的数据点平均值
        groupItemsMap.forEach(({ label, list }, groupKey) => {
            activeMetricConfigs.forEach((mConfig, mIdx) => {
                const sKey = isDualAxis ? `${groupKey}:::${mConfig.key}` : groupKey;
                const mKey = mConfig.key;

                let val = 0;
                if (mKey === "score") {
                    const sum = list.reduce((acc, cur) => acc + (cur.score || 0), 0);
                    val = list.length > 0 ? (sum / list.length) : 0;
                } else if (mKey === "ping") {
                    const validPings = list.filter(i => (i.ping_ms || 0) > 0);
                    val = validPings.length > 0 ? (validPings.reduce((acc, cur) => acc + cur.ping_ms, 0) / validPings.length) : 0;
                } else if (mKey === "ttft") {
                    const valid = list.filter(i => (i.ttft_ms || 0) > 0);
                    val = valid.length > 0 ? (valid.reduce((acc, cur) => acc + cur.ttft_ms, 0) / valid.length) : 0;
                } else if (mKey === "tps") {
                    const valid = list.filter(i => (i.tps || 0) > 0);
                    val = valid.length > 0 ? (valid.reduce((acc, cur) => acc + cur.tps, 0) / valid.length) : 0;
                } else if (mKey === "ttfb") {
                    const valid = list.filter(i => (i.ttfb_ms || 0) > 0);
                    val = valid.length > 0 ? (valid.reduce((acc, cur) => acc + cur.ttfb_ms, 0) / valid.length) : 0;
                }

                if (!seriesMap.has(sKey)) {
                    // 多维矩阵色彩分配
                    const color = getMatrixSeriesColor(groupKey, mKey, mIdx);
                    const sLabel = isDualAxis ? `${label} · ${getMetricShortName(mConfig)}` : label;
                    const isSecondary = (mIdx > 0);

                    // 为辅助轴指标配置虚线样式模式
                    let strokeDash = "";
                    if (activeMetricConfigs.length > 1) {
                        if (mKey === "score") strokeDash = "";
                        else if (mKey === "ping") strokeDash = 'stroke-dasharray="6 3"';
                        else if (mKey === "ttft") strokeDash = 'stroke-dasharray="2 3"';
                        else if (mKey === "tps") strokeDash = 'stroke-dasharray="10 4"';
                        else if (mKey === "ttfb") strokeDash = 'stroke-dasharray="8 3 2 3"';
                    } else if (isSecondary) {
                        strokeDash = 'stroke-dasharray="5 3"';
                    }

                    seriesMap.set(sKey, {
                        key: sKey,
                        groupKey,
                        metricKey: mKey,
                        metricConfig: mConfig,
                        isSecondary,
                        strokeDash,
                        label: sLabel,
                        color,
                        pointsMap: new Map()
                    });
                }
                seriesMap.get(sKey).pointsMap.set(timeKey, {
                    value: parseFloat(val.toFixed(1)),
                    sampleItem: list[0]
                });
                if (mKey === "score") {
                    seriesMap.get(sKey).latestScore = parseFloat(val.toFixed(1));
                }
            });
        });
    });

    let allCandidates = Array.from(seriesMap.values());
    if (activeGroupBy === "node" && allCandidates.length > 12) {
        allCandidates.sort((a, b) => {
            if (b.pointsMap.size !== a.pointsMap.size) {
                return b.pointsMap.size - a.pointsMap.size;
            }
            return (b.latestScore || 0) - (a.latestScore || 0);
        });
        allCandidates = allCandidates.slice(0, 12);
    }
    const candidatesMap = new Map(allCandidates.map(s => [s.key, s]));

    // 剔除被手动移除的系列
    const seriesList = allCandidates.filter(s => !removedSeriesKeys.has(s.key));

    // 4. 更新顶部概览摘要与交互图例
    if (summaryContainer) {
        const unitName = activeTimeMode === "batch" ? t("history.unit_batch", {}, "batches") : t("history.unit_sample", {}, "samples");
        const removedInfo = removedSeriesKeys.size > 0
            ? ` · ${t("history.removed_count", { count: removedSeriesKeys.size }, `Manually excluded ${removedSeriesKeys.size}`)}`
            : "";
        summaryContainer.innerText = t("history.chart_summary", {
            groups: seriesList.length,
            points: sortedTimeKeys.length
        }, `Aggregated ${seriesList.length} groups · ${sortedTimeKeys.length} ${unitName}${removedInfo}`);
    }

    if (legendContainer) {
        const activePillsHtml = seriesList.map(s => {
            const isHidden = hiddenSeriesKeys.has(s.key);
            const lineStyle = s.isSecondary ? "border-style: dashed;" : "";

            return `
                <div class="history-legend-pill ${isHidden ? 'muted' : ''}" data-series-key="${escapeHtml(s.key)}">
                    <span class="history-legend-color-dot" style="background-color: ${s.color}; color: ${s.color}; ${lineStyle}"></span>
                    <span>${escapeHtml(s.label)}</span>
                    <button class="history-legend-remove-btn" type="button" data-remove-key="${escapeHtml(s.key)}" title="${t("history.remove_node_tip", {}, "Remove this node from chart display")}">
                        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                            <line x1="3.5" y1="3.5" x2="12.5" y2="12.5"></line>
                            <line x1="12.5" y1="3.5" x2="3.5" y2="12.5"></line>
                        </svg>
                    </button>
                </div>
            `;
        }).join("");

        let removedGroupHtml = "";
        if (removedSeriesKeys.size > 0) {
            const ghostPills = Array.from(removedSeriesKeys).map(k => {
                const s = candidatesMap.get(k);
                const label = s ? s.label : k;
                return `
                    <button class="history-legend-ghost-pill" type="button" data-restore-key="${escapeHtml(k)}" title="${t("history.restore_single_node", {}, "Click to restore this node display")}">
                        <span class="history-ghost-plus">+</span>
                        <span class="history-ghost-label">${escapeHtml(label)}</span>
                    </button>
                `;
            }).join("");

            removedGroupHtml = `
                <div class="history-legend-removed-group">
                    <button class="history-legend-restore-all-btn" type="button" id="history-restore-all-btn" title="${t("history.restore_all_nodes", {}, "Restore all manually removed nodes")}">
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 8a6 6 0 1 1 1.76 4.24l-2.5 1.5"></path>
                            <polyline points="1 9 1 14 6 14"></polyline>
                        </svg>
                        <span>${t("history.restore_all", {}, "Restore All")} (${removedSeriesKeys.size})</span>
                    </button>
                    ${ghostPills}
                </div>
            `;
        }

        legendContainer.innerHTML = activePillsHtml + removedGroupHtml;

        // 绑定图例胶囊点击事件：切换单条曲线的显隐状态（静音/取消静音）
        legendContainer.querySelectorAll(".history-legend-pill").forEach(pill => {
            pill.addEventListener("click", () => {
                const k = pill.getAttribute("data-series-key");
                if (hiddenSeriesKeys.has(k)) {
                    hiddenSeriesKeys.delete(k);
                } else {
                    hiddenSeriesKeys.add(k);
                }
                renderSvgChart();
            });
        });

        // 绑定单条移除按钮 (X)
        legendContainer.querySelectorAll(".history-legend-remove-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const k = btn.getAttribute("data-remove-key");
                if (k) {
                    removedSeriesKeys.add(k);
                    renderSvgChart();
                }
            });
        });

        // 绑定幽灵胶囊恢复按钮
        legendContainer.querySelectorAll(".history-legend-ghost-pill").forEach(btn => {
            btn.addEventListener("click", () => {
                const k = btn.getAttribute("data-restore-key");
                if (k) {
                    removedSeriesKeys.delete(k);
                    renderSvgChart();
                }
            });
        });

        // 绑定“全部恢复”按钮
        const restoreAllBtn = document.getElementById("history-restore-all-btn");
        if (restoreAllBtn) {
            restoreAllBtn.addEventListener("click", () => {
                removedSeriesKeys.clear();
                renderSvgChart();
            });
        }
    }

    // 若所有系列均被移除，显示全局提示占位文案
    if (seriesList.length === 0) {
        svg.innerHTML = `
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="13">
                ${t("history.all_series_removed", {}, "All selected nodes are currently hidden. Click \"Restore All\" above to display")}
            </text>
        `;
        return;
    }

    // 5. 坐标轴与绘图视口尺寸测算（支持双 Y 轴扩展布局）
    const width = container.clientWidth || 880;
    const height = container.clientHeight || 360;
    const padding = {
        top: 36,
        right: isDualAxis ? 65 : 35,
        bottom: 45,
        left: 55
    };
    const plotW = Math.max(100, width - padding.left - padding.right);
    const plotH = Math.max(100, height - padding.top - padding.bottom);

    // 计算主轴（左侧 Y 轴）标尺动态极值范围
    const { yMin: yMinLeft, yMax: yMaxLeft } = calculateAxisRange(seriesList.filter(s => !s.isSecondary), primaryMetric);

    // 计算辅助轴（右侧 Y 轴，双轴模式下生效）标尺动态极值范围
    const { yMin: yMinRight, yMax: yMaxRight } = isDualAxis
        ? calculateAxisRange(seriesList.filter(s => s.isSecondary), secondaryMetric)
        : { yMin: 0, yMax: 100 };

    const getY = (val, isSecondary = false) => {
        const curMin = isSecondary ? yMinRight : yMinLeft;
        const curMax = isSecondary ? yMaxRight : yMaxLeft;
        if (curMax === curMin) return padding.top + plotH / 2;
        const ratio = (val - curMin) / (curMax - curMin);
        return padding.top + plotH - (ratio * plotH);
    };

    const getX = (timeIndex) => {
        if (sortedTimeKeys.length <= 1) {
            return padding.left + plotW / 2;
        }
        return padding.left + (timeIndex / (sortedTimeKeys.length - 1)) * plotW;
    };

    // 6. 拼装 SVG DOM 树
    let svgHtml = ``;

    // 6.1 水平参考网格线与左侧主 Y 轴刻度
    svgHtml += `<g class="history-chart-grid">`;
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const ratio = i / ySteps;
        const curY = padding.top + plotH - (ratio * plotH);
        const curValLeft = yMinLeft + ratio * (yMaxLeft - yMinLeft);
        const valTextLeft = primaryMetric.key === "score" ? Math.round(curValLeft) : (curValLeft >= 100 ? Math.round(curValLeft) : curValLeft.toFixed(1));

        svgHtml += `
            <line x1="${padding.left}" y1="${curY}" x2="${padding.left + plotW}" y2="${curY}" />
            <text x="${padding.left - 8}" y="${curY + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11">
                ${valTextLeft}
            </text>
        `;

        // 在双 Y 轴模式下渲染右侧刻度文本
        if (isDualAxis) {
            const curValRight = yMinRight + ratio * (yMaxRight - yMinRight);
            const valTextRight = secondaryMetric.key === "score" ? Math.round(curValRight) : (curValRight >= 100 ? Math.round(curValRight) : curValRight.toFixed(1));
            svgHtml += `
                <text x="${padding.left + plotW + 8}" y="${curY + 4}" text-anchor="start" fill="var(--accent-secondary)" font-size="11">
                    ${valTextRight}
                </text>
            `;
        }
    }
    svgHtml += `</g>`;

    // 6.2 轴线标题与极性方向徽章（越高越好 / 越低越好）
    const leftAxisLabel = t("history.axis_left", {}, "[Left Axis]");
    const rightAxisLabel = t("history.axis_right", {}, "[Right Axis]");
    const primaryDir = primaryMetric.higherIsBetter
        ? t("history.axis_dir_higher", {}, "Higher is better ↑")
        : t("history.axis_dir_lower", {}, "Lower is better ↓");
    const secondaryDir = secondaryMetric.higherIsBetter
        ? t("history.axis_dir_higher", {}, "Higher is better ↑")
        : t("history.axis_dir_lower", {}, "Lower is better ↓");

    svgHtml += `
        <text x="${padding.left}" y="${padding.top - 12}" fill="var(--text-secondary)" font-size="11" font-weight="600">
            ${leftAxisLabel} ${getMetricShortName(primaryMetric)} (${primaryDir})
        </text>
    `;
    if (isDualAxis) {
        svgHtml += `
            <text x="${padding.left + plotW}" y="${padding.top - 12}" text-anchor="end" fill="var(--accent-secondary)" font-size="11" font-weight="600">
                ${rightAxisLabel} ${getMetricShortName(secondaryMetric)} (${secondaryDir})
            </text>
        `;
    }

    // 6.3 X 轴时间刻度标签（等间距均匀采样与防重叠避让）
    svgHtml += `<g class="history-chart-axis">`;
    svgHtml += `<line x1="${padding.left}" y1="${padding.top + plotH}" x2="${padding.left + plotW}" y2="${padding.top + plotH}" />`;

    // 检查时序数据点是否跨天
    let isCrossDays = false;
    if (sortedTimeKeys.length >= 2) {
        const d1 = new Date(sortedTimeKeys[0]);
        const d2 = new Date(sortedTimeKeys[sortedTimeKeys.length - 1]);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
            isCrossDays = (d1.toDateString() !== d2.toDateString());
        }
    }

    if (sortedTimeKeys.length === 1) {
        const midX = getX(0);
        const label = formatShortTime(sortedTimeKeys[0], isCrossDays);
        svgHtml += `
            <line x1="${midX}" y1="${padding.top}" x2="${midX}" y2="${padding.top + plotH}" stroke="var(--border-subtle)" stroke-dasharray="3 3" />
            <line x1="${midX}" y1="${padding.top + plotH}" x2="${midX}" y2="${padding.top + plotH + 5}" stroke="var(--border-color)" />
            <text x="${midX}" y="${padding.top + plotH + 18}" text-anchor="middle" fill="var(--text-primary)" font-weight="600" font-size="11" font-family="ui-monospace, monospace">
                ${escapeHtml(label)}
            </text>
        `;
    } else {
        // 为每个时间标签预留至少 95px 的安全间距，防止文字重叠交叉
        const maxTicks = Math.max(2, Math.min(sortedTimeKeys.length, Math.floor(plotW / 95)));
        const tickIndices = [];

        if (maxTicks >= sortedTimeKeys.length) {
            for (let i = 0; i < sortedTimeKeys.length; i++) tickIndices.push(i);
        } else {
            // 均匀对齐采样 maxTicks 个时间点，严格锁合首尾边界
            const stride = (sortedTimeKeys.length - 1) / (maxTicks - 1);
            for (let i = 0; i < maxTicks; i++) {
                tickIndices.push(Math.round(i * stride));
            }
        }

        const uniqueIndices = Array.from(new Set(tickIndices));
        uniqueIndices.forEach(idx => {
            const timeKey = sortedTimeKeys[idx];
            const x = getX(idx);
            const timeLabel = formatShortTime(timeKey, isCrossDays);
            svgHtml += `
                <line x1="${x}" y1="${padding.top + plotH}" x2="${x}" y2="${padding.top + plotH + 5}" stroke="var(--border-color)" />
                <text x="${x}" y="${padding.top + plotH + 18}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="ui-monospace, monospace">
                    ${escapeHtml(timeLabel)}
                </text>
            `;
        });
    }
    svgHtml += `</g>`;

    // 渲染极简圆形数据采样点（极性分组后无需额外的三角方向符号）
    const renderPointMarker = (cx, cy, fill, stroke, strokeW, timeIdx, seriesKey, isSecondary = false) => {
        const r = isSecondary ? 3.4 : 4.0;
        return `
            <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"
                    fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"
                    class="history-point-circle" data-point-idx="${timeIdx}" data-series-key="${escapeHtml(seriesKey)}" />
        `;
    };

    // 6.4 绘制三次贝塞尔平滑折线与端点标记
    seriesList.forEach((s, idx) => {
        if (hiddenSeriesKeys.has(s.key)) return;

        const pts = [];
        sortedTimeKeys.forEach((timeKey, timeIdx) => {
            if (s.pointsMap.has(timeKey)) {
                const pt = s.pointsMap.get(timeKey);
                const x = getX(timeIdx);
                const y = getY(pt.value, s.isSecondary);
                pts.push({ x, y, value: pt.value, timeKey, timeIdx, series: s });
            }
        });

        if (pts.length === 0) return;

        if (sortedTimeKeys.length === 1 || pts.length === 1) {
            const p = pts[0];
            const ptFill = s.isSecondary ? "#ffffff" : s.color;
            const ptStroke = s.color;
            svgHtml += `
                ${renderPointMarker(p.x, p.y, ptFill, ptStroke, 2, p.timeIdx, s.key, s.isSecondary)}
                <text x="${(p.x + 10).toFixed(1)}" y="${(p.y + 4).toFixed(1)}"
                      fill="${s.color}" font-weight="600" font-size="11" font-family="ui-monospace, monospace">
                    ${escapeHtml(s.label)} (${formatMetricVal(p.value, s.metricKey)})
                </text>
            `;
        } else {
            let pathD = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i];
                const p1 = pts[i + 1];
                const dx = (p1.x - p0.x) * 0.35;
                const cp1x = p0.x + dx;
                const cp1y = p0.y;
                const cp2x = p1.x - dx;
                const cp2y = p1.y;
                pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
            }

            const strokeDash = s.strokeDash || (s.isSecondary ? `stroke-dasharray="5 3"` : "");
            svgHtml += `<path d="${pathD}" stroke="${s.color}" ${strokeDash} class="history-curve-path" />`;

            pts.forEach(p => {
                const circleFill = s.isSecondary ? "#ffffff" : s.color;
                const circleStroke = s.color;
                const strokeW = s.isSecondary ? "2" : "1.8";
                svgHtml += renderPointMarker(p.x, p.y, circleFill, circleStroke, strokeW, p.timeIdx, s.key, s.isSecondary);
            });
        }
    });

    // 6.5 垂直十字标尺辅助虚线
    svgHtml += `
        <line id="history-chart-crosshair" class="history-crosshair-line"
              x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotH}"
              style="display: none;" />
    `;

    // 6.6 鼠标悬浮交互感应热区
    svgHtml += `
        <rect id="history-chart-hitbox" x="${padding.left}" y="${padding.top}"
              width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair;" />
    `;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = svgHtml;

    // 7. 绑定十字标尺对齐与浮窗 Tooltip 交互监听
    const hitbox = document.getElementById("history-chart-hitbox");
    const crosshair = document.getElementById("history-chart-crosshair");

    if (hitbox) {
        hitbox.addEventListener("mousemove", (e) => {
            const rect = hitbox.getBoundingClientRect();
            const mouseX = e.clientX - rect.left + padding.left;

            let closestIdx = 0;
            let minDiff = Infinity;
            sortedTimeKeys.forEach((_, idx) => {
                const curX = getX(idx);
                const diff = Math.abs(curX - mouseX);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });

            const targetTimeKey = sortedTimeKeys[closestIdx];
            const targetX = getX(closestIdx);

            if (crosshair) {
                crosshair.setAttribute("x1", targetX);
                crosshair.setAttribute("x2", targetX);
                crosshair.style.display = "block";
            }

            svg.querySelectorAll(".history-point-circle, .history-point-marker").forEach(c => {
                if (parseInt(c.getAttribute("data-point-idx"), 10) === closestIdx) {
                    c.classList.add("highlighted");
                } else {
                    c.classList.remove("highlighted");
                }
            });

            const activePointsAtTime = [];
            seriesList.forEach(s => {
                if (hiddenSeriesKeys.has(s.key)) return;
                if (s.pointsMap.has(targetTimeKey)) {
                    activePointsAtTime.push({
                        series: s,
                        data: s.pointsMap.get(targetTimeKey)
                    });
                }
            });

            if (tooltip && activePointsAtTime.length > 0) {
                let rowsHtml = activePointsAtTime.map(({ series, data }) => {
                    const isHigher = series.metricConfig.higherIsBetter;
                    const dirTagText = isHigher ? t("history.dir_tag_higher", {}, "↑ Best") : t("history.dir_tag_lower", {}, "↓ Best");
                    const dirClass = isHigher ? "higher" : "lower";
                    const dirTitle = isHigher ? t("history.dir_higher", {}, "↑ Higher is better") : t("history.dir_lower", {}, "↓ Lower is better");

                    return `
                        <div class="history-tooltip-row">
                            <div class="history-tooltip-key">
                                <span class="history-legend-color-dot" style="background-color: ${series.color};"></span>
                                <span>${escapeHtml(series.label)}</span>
                                <span class="history-legend-dir-tag ${dirClass}" title="${escapeHtml(dirTitle)}">${escapeHtml(dirTagText)}</span>
                            </div>
                            <div class="history-tooltip-val">
                                ${formatMetricVal(data.value, series.metricKey)}
                            </div>
                        </div>
                    `;
                }).join("");

                tooltip.innerHTML = `
                    <div class="history-tooltip-header">
                        <span>🕒</span>
                        <span>${escapeHtml(formatFullDateTime(targetTimeKey) || targetTimeKey)}</span>
                    </div>
                    <div>${rowsHtml}</div>
                `;

                tooltip.style.display = "block";

                const containerRect = container.getBoundingClientRect();
                let tooltipX = targetX + 15;
                if (tooltipX + 260 > containerRect.width) {
                    tooltipX = targetX - 270;
                }
                tooltip.style.left = `${tooltipX}px`;
                tooltip.style.top = `${padding.top + 10}px`;
            }
        });

        hitbox.addEventListener("mouseleave", () => {
            if (crosshair) crosshair.style.display = "none";
            if (tooltip) tooltip.style.display = "none";
            svg.querySelectorAll(".history-point-circle, .history-point-marker").forEach(c => c.classList.remove("highlighted"));
        });
    }
}

/**
 * 计算单个 Y 轴维度的最小值与最大值标尺极值范围
 * @param {Array<Object>} seriesForAxis - 归属该坐标轴的时序系列集合
 * @param {Object} metricConfig - 当前指标项配置元数据
 * @returns {{ yMin: number, yMax: number }}
 */
function calculateAxisRange(seriesForAxis, metricConfig) {
    if (metricConfig.fixedMin !== undefined && metricConfig.fixedMax !== undefined) {
        return { yMin: metricConfig.fixedMin, yMax: metricConfig.fixedMax };
    }

    let allValues = [];
    seriesForAxis.forEach(s => {
        if (hiddenSeriesKeys.has(s.key)) return;
        s.pointsMap.forEach(p => {
            if (typeof p.value === "number") allValues.push(p.value);
        });
    });

    if (allValues.length === 0) {
        return { yMin: 0, yMax: 100 };
    }

    const minV = Math.min(...allValues);
    const maxV = Math.max(...allValues);
    if (minV === maxV) {
        return { yMin: 0, yMax: maxV > 0 ? maxV * 1.3 : 10 };
    }
    return {
        yMin: Math.max(0, Math.floor(minV * 0.85)),
        yMax: Math.ceil(maxV * 1.15)
    };
}

/**
 * 格式化紧凑时间标签（同天显示 HH:mm:ss，跨天显示 MM-DD HH:mm）
 * @param {string} timeStr - 原始时间字符串
 * @param {boolean} [needDate=false] - 是否强制包含月份与日期
 * @returns {string} 格式化后的时间文案
 */
export function formatShortTime(timeStr, needDate = false) {
    if (!timeStr) return "";
    // 若已是标准的纯 HH:mm:ss 格式，直接原样返回
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(timeStr.trim())) {
        return timeStr.trim();
    }

    try {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) {
            const pad = (n) => String(n).padStart(2, "0");
            const hours = pad(d.getHours());
            const mins = pad(d.getMinutes());
            const secs = pad(d.getSeconds());
            if (needDate) {
                const month = pad(d.getMonth() + 1);
                const day = pad(d.getDate());
                return `${month}-${day} ${hours}:${mins}`;
            }
            return `${hours}:${mins}:${secs}`;
        }
    } catch (_) { }

    // 正则精准提取 ISO 时间格式中的时间片段（如 2026-11-17T11:28:24.123+09:00 -> 11:28:24）
    const match = timeStr.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) {
        return match[1];
    }

    const parts = timeStr.trim().split(" ");
    if (parts.length === 2) {
        return parts[1];
    }
    return timeStr.slice(-8);
}

/**
 * 带工程单位格式化指标数值
 * @param {number} val - 待格式化的数值
 * @param {string} metric - 指标键名（score / ping / ttft / tps / ttfb）
 * @returns {string} 格式化带单位的文本
 */
export function formatMetricVal(val, metric) {
    if (typeof val !== "number" || isNaN(val)) return "-";
    if (metric === "score") {
        return `${val.toFixed(1)} pts`;
    } else if (metric === "ping" || metric === "ttft" || metric === "ttfb") {
        return `${Math.round(val)} ms`;
    } else if (metric === "tps") {
        return `${val.toFixed(1)} TPS`;
    }
    return `${val}`;
}
