/**
 * diag.js
 * 订阅异常模式识别分析引擎与错误诊断模态窗控制器。
 */

import { escapeHtml } from "./utils.js";
import { t } from "./i18n/i18n.js";

let currentDiagAirport = null;
let onEditCallback = null;
let onRetryCallback = null;

/**
 * 校验机场订阅 URL 的合法性与传输协议。
 * @param {string} url - 待校验的订阅 URL 字符串
 * @returns {string|null} 校验失败时返回错误提示文本，合法时返回 null
 */
export function validateSubscriptionURL(url) {
    if (!url) return t("diag.url_empty", {}, "⚠️ Please enter subscription URL");
    const trimmed = url.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        return t("diag.url_protocol", {}, "⚠️ Subscription URL must start with http:// or https://");
    }
    try {
        const u = new URL(trimmed);
        if (!u.hostname) return t("diag.url_domain", {}, "⚠️ Subscription URL domain is invalid, please verify completeness");
    } catch (e) {
        return t("diag.url_invalid", {}, "⚠️ Subscription URL format is invalid, please check for spaces or extra characters");
    }
    return null;
}

/**
 * 在机场表单下方展示辅助提示信息。
 * @param {string} msg - 提示文本内容
 */
export function showAirportFormTip(msg) {
    const tipEl = document.getElementById("airport-form-tip");
    if (!tipEl) return;
    tipEl.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    tipEl.classList.remove("hidden");
}

/**
 * 隐藏机场表单下方的辅助提示信息。
 */
export function hideAirportFormTip() {
    const tipEl = document.getElementById("airport-form-tip");
    if (!tipEl) return;
    tipEl.innerHTML = "";
    tipEl.classList.add("hidden");
}

/**
 * 深入分析订阅拉取或节点解析失败的具体原因，并输出专业排错建议。
 * @param {string} url - 机场订阅 URL
 * @param {string} errStr - 后端返回的原始错误堆栈或异常描述
 * @returns {{ title: string, advice: string }} 包含错误分类标题与排错建议的对象
 */
export function analyzeSubscriptionError(url, errStr) {
    const errLower = (errStr || "").toLowerCase();

    if (/\b403\b/.test(errLower) || errLower.includes("forbidden")) {
        return {
            title: t("diag.err_403_title", {}, "🚫 HTTP 403 Forbidden"),
            advice: t("diag.err_403_advice", {}, "1. Subscription link may have expired, been banned, or data quota is exhausted;<br>2. URL parameters may be truncated (e.g. missing token or incomplete token characters);<br>3. Airport server detected restricted client or IP.<br><b>Troubleshooting:</b> Log in to the airport dashboard and re-copy the complete Clash / Mihomo subscription link.")
        };
    }
    if (/\b401\b/.test(errLower) || errLower.includes("unauthorized")) {
        return {
            title: t("diag.err_401_title", {}, "🔒 HTTP 401 Unauthorized"),
            advice: t("diag.err_401_advice", {}, "Subscription authentication token or authorization credential has expired.<br><b>Troubleshooting:</b> Please regenerate and copy the subscription link from the airport dashboard.")
        };
    }
    if (/\b404\b/.test(errLower) || errLower.includes("not found")) {
        return {
            title: t("diag.err_404_title", {}, "🔍 HTTP 404 Not Found"),
            advice: t("diag.err_404_advice", {}, "Subscription address does not exist.<br><b>Troubleshooting:</b> Please verify the subscription URL domain and request path to ensure no extra characters were copied.")
        };
    }
    if (/\b(500|502|503|504)\b/.test(errLower) || errLower.includes("bad gateway") || errLower.includes("service unavailable") || errLower.includes("gateway timeout")) {
        return {
            title: t("diag.err_5xx_title", {}, "💥 HTTP 5xx Airport Server Error"),
            advice: t("diag.err_5xx_advice", {}, "The airport subscription server is temporarily down or under maintenance.<br><b>Troubleshooting:</b> Please retry later or check the airport announcement channel.")
        };
    }
    if (errLower.includes("timeout") || errLower.includes("timed out") || errLower.includes("timedout") || errLower.includes("deadline exceeded")) {
        return {
            title: t("diag.err_timeout_title", {}, "⏳ Connection Timeout"),
            advice: t("diag.err_timeout_advice", {}, "Failed to connect to subscription server, possibly due to network block, local DNS pollution, or disconnect.<br><b>Troubleshooting:</b> Check local network connection or try using an upstream proxy first.")
        };
    }
    if (errLower.includes("no such host") || errLower.includes("lookup")) {
        return {
            title: t("diag.err_dns_title", {}, "🌐 DNS Resolution Failed (Name Not Resolved)"),
            advice: t("diag.err_dns_advice", {}, "Cannot resolve subscription server domain name.<br><b>Troubleshooting:</b> Check subscription domain spelling or change local DNS servers.")
        };
    }
    if (errLower.includes("failed to parse") || errLower.includes("no valid nodes") || errLower.includes("0 nodes") || errLower.includes("0 proxies") || errLower.includes("未能解析出") || errLower.includes("0 个") || errLower.includes("0 节点") || errLower.includes("unsupported uri protocol") || errLower.includes("empty") || errLower.includes("no proxies")) {
        return {
            title: t("diag.err_empty_title", {}, "📄 No Proxies Found (Empty)"),
            advice: t("diag.err_empty_advice", {}, "Content was downloaded successfully, but no valid proxies were parsed (missing Clash proxies list, Base64, or valid protocol entries).<br><b>Troubleshooting:</b> This URL may be a regular webpage rather than a subscription feed; ensure copying the Clash / Mihomo format subscription.")
        };
    }

    return {
        title: t("diag.err_unknown_title", {}, "⚠️ Subscription Fetch / Parse Error"),
        advice: t("diag.err_unknown_advice", {}, "Failed to fetch or parse proxy nodes from this airport.<br><b>Troubleshooting:</b> Verify URL integrity or try opening it in a browser to check if it downloads normally.")
    };
}

/**
 * 初始化订阅异常诊断模态弹窗的交互事件监听器。
 * @param {Function} onEdit - 点击“编辑链接”时的业务回调函数
 * @param {Function} onRetry - 点击“立即重试”时的业务回调函数
 */
export function initErrorDiagModal(onEdit, onRetry) {
    onEditCallback = onEdit;
    onRetryCallback = onRetry;

    const modalErrorDiag = document.getElementById("modal-error-diag");
    const errorDiagClose = document.getElementById("error-diag-close");
    const diagBtnClose = document.getElementById("diag-btn-close");
    const diagBtnEdit = document.getElementById("diag-btn-edit");
    const diagBtnRetry = document.getElementById("diag-btn-retry");

    if (!modalErrorDiag) return;

    if (errorDiagClose) errorDiagClose.addEventListener("click", closeErrorDiagModal);
    if (diagBtnClose) diagBtnClose.addEventListener("click", closeErrorDiagModal);
    modalErrorDiag.addEventListener("click", (e) => {
        if (e.target === modalErrorDiag) {
            closeErrorDiagModal();
        }
    });

    if (diagBtnEdit) {
        diagBtnEdit.addEventListener("click", () => {
            if (!currentDiagAirport) return;
            const target = currentDiagAirport;
            closeErrorDiagModal();
            if (typeof onEditCallback === "function") {
                onEditCallback(target);
            }
        });
    }

    if (diagBtnRetry) {
        diagBtnRetry.addEventListener("click", () => {
            if (!currentDiagAirport) return;
            const targetId = currentDiagAirport.id;
            closeErrorDiagModal();
            if (typeof onRetryCallback === "function") {
                onRetryCallback(targetId);
            }
        });
    }
}

/**
 * 打开订阅错误诊断模态弹窗并渲染智能分析结果。
 * @param {Object} airport - 目标机场数据实体
 * @param {string} errStr - 错误异常描述文本
 */
export function openErrorDiagModal(airport, errStr) {
    const modalErrorDiag = document.getElementById("modal-error-diag");
    const diagAirportName = document.getElementById("diag-airport-name");
    const diagAirportUrl = document.getElementById("diag-airport-url");
    const diagAnalysis = document.getElementById("diag-analysis");
    const diagRawError = document.getElementById("diag-raw-error");

    if (!airport || !modalErrorDiag) return;
    currentDiagAirport = airport;
    const errorText = errStr || airport.lastError || t("diag.unknown_error", {}, "Unknown Error");
    const analysis = analyzeSubscriptionError(airport.url, errorText);

    if (diagAirportName) diagAirportName.innerText = airport.name;
    if (diagAirportUrl) diagAirportUrl.innerText = airport.url || t("diag.no_url", {}, "(No URL)");
    if (diagAnalysis) {
        diagAnalysis.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-red);">${analysis.title}</div>
            <div>${analysis.advice}</div>
        `;
    }
    if (diagRawError) diagRawError.innerText = errorText;

    modalErrorDiag.classList.remove("hidden");
}

/**
 * 关闭订阅错误诊断模态弹窗并重置当前诊断实体状态。
 */
export function closeErrorDiagModal() {
    const modalErrorDiag = document.getElementById("modal-error-diag");
    if (modalErrorDiag) modalErrorDiag.classList.add("hidden");
    currentDiagAirport = null;
}
