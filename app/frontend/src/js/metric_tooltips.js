/**
 * metric_tooltips.js
 * AI 评测指标专业释义字典与动态 DOM 悬浮提示框 (Tooltip) 注入器。
 * 
 * 核心目标：
 * 统一指标技术分析、评分原理与权重说明，支持无缝 i18n 语言切换。
 */

import { t, onLanguageChange } from "./i18n/i18n.js";

/**
 * 默认指标元数据与说明配置字典。
 */
export const METRIC_TOOLTIPS = {
    ping: {
        title: "Node Connectivity & Handshake (Node Ping / RTT)",
        badgeClass: "weight-badge veto",
        higherIsBetter: false
    },
    score: {
        title: "Comprehensive Score (Score)",
        badgeClass: "weight-badge opt-high",
        higherIsBetter: true
    },
    availability: {
        title: "Service Availability (Availability)",
        badgeClass: "weight-badge veto",
        higherIsBetter: true
    },
    ttfb: {
        title: "Connection & First Packet Latency (TTFB)",
        badgeClass: "weight-badge opt-low",
        higherIsBetter: false
    },
    ttft: {
        title: "AI Time to First Token (TTFT)",
        badgeClass: "weight-badge opt-low",
        higherIsBetter: false
    },
    tps: {
        title: "TPS Rate (Tokens Per Second)",
        badgeClass: "weight-badge opt-high",
        higherIsBetter: true
    },
    jitter: {
        title: "Jitter Variance (Gap / Jitter)",
        badgeClass: "weight-badge opt-low",
        higherIsBetter: false
    },
    ingress: {
        title: "Ingress Uplink Bandwidth",
        badgeClass: "weight-badge opt-high",
        higherIsBetter: true
    },
    time: {
        title: "Snapshot Timestamp",
        badgeClass: "",
        higherIsBetter: false
    }
};

/**
 * 生成单个指标的富文本 HTML 悬浮提示框 (Tooltip Box)。
 * @param {string} metricKey - 指标键名 (如 'ping' | 'ttfb' | 'ttft' | 'tps' | 'jitter' | 'ingress' 等)
 * @returns {string} 渲染后的 HTML 字符串
 */
export function renderTooltipHtml(metricKey) {
    const meta = METRIC_TOOLTIPS[metricKey];
    if (!meta) return "";

    const title = t(`metric_tooltips.${metricKey}.title`, {}, meta.title);
    const badgeText = t(`metric_tooltips.${metricKey}.badge`, {}, "");
    const badgeHtml = badgeText ? `<span class="${meta.badgeClass}">${badgeText}</span>` : "";

    const roleLabel = t("metric_tooltips.role_label", {}, "📌 Purpose");
    const whyLabel = t("metric_tooltips.why_label", {}, "🎯 Why Test It");
    const howLabel = t("metric_tooltips.how_label", {}, "🔬 How It Tests");
    const evalLabel = t("metric_tooltips.eval_label", {}, "📊 Evaluation");
    const weightLabel = t("metric_tooltips.weight_label", {}, "⚖️ Weight Ratio");

    const role = t(`metric_tooltips.${metricKey}.role`, {}, "");
    const why = t(`metric_tooltips.${metricKey}.why`, {}, "");
    const how = t(`metric_tooltips.${metricKey}.how`, {}, "");
    const evalText = t(`metric_tooltips.${metricKey}.eval`, {}, "");
    const weight = t(`metric_tooltips.${metricKey}.weight`, {}, "");

    let html = `<span class="tooltip-box">`;
    html += `<div class="tooltip-title">${title} ${badgeHtml}</div>`;
    if (role) html += `<div class="tooltip-section"><strong>${roleLabel}：</strong>${role}</div>`;
    if (weight) html += `<div class="tooltip-section"><strong>${weightLabel}：</strong>${weight}</div>`;
    if (why) html += `<div class="tooltip-section"><strong>${whyLabel}：</strong>${why}</div>`;
    if (how) html += `<div class="tooltip-section"><strong>${howLabel}：</strong>${how}</div>`;
    if (evalText) {
        const evalVal = evalText.replace(/(该值越低越好|该值越高越好|Available 最佳|Lower is better|Higher is better|Available is best)/g, '<b style="color: var(--accent-green);">$1</b>');
        html += `<div class="tooltip-section"><strong>${evalLabel}：</strong>${evalVal}</div>`;
    }
    html += `</span>`;
    return html;
}

/**
 * 遍历 DOM 容器，自动为所有带有 .info-icon[data-metric] 的元素注入 Tooltip 节点。
 * @param {HTMLElement|Document} container - 目标宿主 DOM 节点或根文档
 */
export function injectMetricTooltips(container = document) {
    if (!container) return;
    const icons = container.querySelectorAll(".info-icon[data-metric]");
    icons.forEach(icon => {
        const key = icon.getAttribute("data-metric");
        if (key && !icon.querySelector(".tooltip-box")) {
            const boxHtml = renderTooltipHtml(key);
            if (boxHtml) {
                icon.insertAdjacentHTML("beforeend", boxHtml);
            }
        }
    });
}

/**
 * 重新渲染页面中所有已注入的指标 Tooltip（例如在语言切换后触发）。
 */
export function refreshMetricTooltips() {
    document.querySelectorAll(".info-icon[data-metric]").forEach(icon => {
        const existing = icon.querySelector(".tooltip-box");
        if (existing) existing.remove();
        const key = icon.getAttribute("data-metric");
        if (key) {
            const boxHtml = renderTooltipHtml(key);
            if (boxHtml) {
                icon.insertAdjacentHTML("beforeend", boxHtml);
            }
        }
    });
}

// 注册全局语言切换监听器，语言变动时重新刷新所有指标说明
onLanguageChange(refreshMetricTooltips);
