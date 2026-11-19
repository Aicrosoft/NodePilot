/**
 * utils.js
 * 纯工具函数库与轻量级交互反馈组件（Toast 轻提示、二次确认模态窗）。
 */

import { t } from "./i18n/i18n.js";

/**
 * 转义 HTML 特殊字符以防御 XSS 跨站脚本攻击。
 * @param {string} str - 待转义的原始字符串
 * @returns {string} 转义后的安全文本
 */
export function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 将当前时刻格式化为短日期时间 (MM-DD HH:mm)。
 * @returns {string} 格式化后的时间字符串
 */
export function formatNow() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 将日期格式化为完整时间字符串 (YYYY-MM-DD HH:mm:ss)。
 * @param {Date|string|number} inputDate - 日期对象或时间戳
 * @returns {string} 完整时间字符串
 */
export function formatFullDateTime(inputDate) {
    const d = inputDate instanceof Date ? inputDate : (inputDate ? new Date(inputDate) : new Date());
    if (isNaN(d.getTime())) return formatNow();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let toastTimer = null;

/**
 * 展示非阻断式浮动 Toast 轻提示。
 * @param {string} msg - 提示内容文本
 * @param {string} type - Toast 视觉类型 ('info' | 'warning' | 'error')
 */
export function showToast(msg, type = "info") {
    let toast = document.getElementById("np-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "np-toast";
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.className = `np-toast show ${type === 'warning' ? 'toast-warning' : (type === 'error' ? 'toast-error' : '')}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
        toastTimer = null;
    }, 2800);
}

// 二次确认对话框回调状态管理
let pendingConfirmAction = null;

/**
 * 初始化通用二次确认模态弹窗的交互事件监听。
 */
export function initConfirmModal() {
    const modalConfirm = document.getElementById("modal-confirm");
    const confirmBtnClose = document.getElementById("confirm-btn-close");
    const confirmBtnCancel = document.getElementById("confirm-btn-cancel");
    const confirmBtnOk = document.getElementById("confirm-btn-ok");

    if (confirmBtnClose) confirmBtnClose.addEventListener("click", closeConfirmModal);
    if (confirmBtnCancel) confirmBtnCancel.addEventListener("click", closeConfirmModal);
    if (modalConfirm) {
        modalConfirm.addEventListener("click", (e) => {
            if (e.target === modalConfirm) {
                closeConfirmModal();
            }
        });
    }
    if (confirmBtnOk) {
        confirmBtnOk.addEventListener("click", () => {
            if (typeof pendingConfirmAction === "function") {
                pendingConfirmAction();
            }
            closeConfirmModal();
        });
    }
}

/**
 * 打开通用二次确认对话框。
 * @param {string} title - 弹窗标题（支持安全 HTML）
 * @param {string} message - 确认说明内容（支持安全 HTML）
 * @param {Function} onConfirm - 用户点击确认后的执行回调函数
 * @param {string} [okText] - 确认按钮文本
 * @param {string} [okClass] - 确认按钮视觉样式类名（如 'btn-danger' | 'btn-primary'）
 * @param {string} [cancelText] - 取消按钮文本
 */
export function openConfirmModal(title, message, onConfirm, okText = null, okClass = "btn-danger", cancelText = null) {
    const modalConfirm = document.getElementById("modal-confirm");
    const confirmTitle = document.getElementById("confirm-title");
    const confirmMessage = document.getElementById("confirm-message");
    const confirmBtnOk = document.getElementById("confirm-btn-ok");
    const confirmBtnCancel = document.getElementById("confirm-btn-cancel");

    if (!modalConfirm) return;
    if (confirmTitle) confirmTitle.innerHTML = title;
    if (confirmMessage) confirmMessage.innerHTML = message;
    if (confirmBtnOk) {
        confirmBtnOk.innerText = okText || t("modal.confirm", {}, "Confirm");
        confirmBtnOk.className = `btn ${okClass}`;
    }
    if (confirmBtnCancel) {
        confirmBtnCancel.innerText = cancelText || t("modal.cancel", {}, "Cancel");
    }
    pendingConfirmAction = onConfirm;
    modalConfirm.classList.remove("hidden");
}

/**
 * 关闭通用二次确认对话框并重置回调状态。
 */
export function closeConfirmModal() {
    const modalConfirm = document.getElementById("modal-confirm");
    if (modalConfirm) modalConfirm.classList.add("hidden");
    pendingConfirmAction = null;
}

/**
 * 统一定义并从测速结果对象中提取标准指标字段。
 * @param {Object} r - 原始或持久化的测速记录对象
 * @returns {Object} 归一化后的指标字段集合
 */
export function extractMetrics(r) {
    if (!r) {
        return {
            ttfb_ms: 0,
            ttft_ms: 0,
            tps: 0,
            jitter_ms: 0,
            ingress_bps: 0,
            proxy_buffer_detected: false,
            score: 0,
            status: "Unavailable",
            service_name: "",
            node_name: ""
        };
    }

    // TTFB: 毫秒级首包延迟（优先取 network.ttfb，回退至 total_time）
    let ttfb_ms = 0;
    if (r.network && typeof r.network.ttfb === "number" && r.network.ttfb > 0) {
        ttfb_ms = Math.round(r.network.ttfb / 1e6);
    } else if (typeof r.ttfb_ms === "number" && r.ttfb_ms > 0) {
        ttfb_ms = Math.round(r.ttfb_ms);
    } else if (r.network && typeof r.network.total_time === "number" && r.network.total_time > 0) {
        ttfb_ms = Math.round(r.network.total_time / 1e6);
    } else if (typeof r.total_time_ms === "number" && r.total_time_ms > 0) {
        ttfb_ms = Math.round(r.total_time_ms);
    }

    // TTFT: 毫秒级首字延迟（若收到首个流式 chunk 则采纳，否则与 TTFB 对齐）
    let ttft_ms = 0;
    if (r.stream && typeof r.stream.ttft === "number" && r.stream.ttft > 0) {
        ttft_ms = Math.round(r.stream.ttft / 1e6);
    } else if (typeof r.ttft_ms === "number" && r.ttft_ms > 0) {
        ttft_ms = Math.round(r.ttft_ms);
    } else if (ttfb_ms > 0) {
        ttft_ms = ttfb_ms;
    }

    // TPS: 每秒生成 Token 速率
    let tps = 0;
    if (r.stream && typeof r.stream.tps === "number" && r.stream.tps > 0) {
        tps = r.stream.tps;
    } else if (typeof r.tps === "number" && r.tps > 0) {
        tps = r.tps;
    }

    // Jitter: 流式生成抖动方差 (ms)
    let jitter_ms = 0;
    if (r.stream && typeof r.stream.jitter_variance_ms === "number" && r.stream.jitter_variance_ms > 0) {
        jitter_ms = r.stream.jitter_variance_ms;
    } else if (typeof r.jitter_ms === "number" && r.jitter_ms > 0) {
        jitter_ms = r.jitter_ms;
    }

    // Ingress: 入口上行测速吞吐量 (Bytes/s)
    let ingress_bps = 0;
    if (r.stream && typeof r.stream.ingress_speed_byte_sec === "number" && r.stream.ingress_speed_byte_sec > 0) {
        ingress_bps = r.stream.ingress_speed_byte_sec;
    } else if (typeof r.ingress_bps === "number" && r.ingress_bps > 0) {
        ingress_bps = r.ingress_bps;
    } else if (typeof r.bandwidth_bps === "number" && r.bandwidth_bps > 0) {
        ingress_bps = r.bandwidth_bps;
    }

    const proxy_buffer_detected = !!(r.stream && r.stream.proxy_buffer_detected) || !!r.proxy_buffer_detected;
    const score = typeof r.score === "number" ? r.score : 0;
    const status = r.status || "Unavailable";
    const service_name = r.service_name || r.service || r.ai_offer || "";
    const ai_offer = r.ai_offer || service_name;
    const node_name = r.node_name || r.node || "";
    const airport_name = r.airport_name || r.airport || "";
    const tested_at = r.tested_at || new Date().toISOString();
    const tested_time_display = r.tested_time_display || formatFullDateTime(tested_at);
    const ping_ms = typeof r.ping_ms === "number" ? Math.round(r.ping_ms) : 0;
    const ping_status = r.ping_status || (ping_ms > 0 ? "ok" : "");

    return {
        airport_name,
        node_name,
        ai_offer,
        service_name,
        status,
        ping_ms,
        ping_status,
        score,
        ttfb_ms,
        ttft_ms,
        tps,
        jitter_ms,
        ingress_bps,
        proxy_buffer_detected,
        tested_at,
        tested_time_display
    };
}

/**
 * 根据综合评测得分计算对应的评分级别 CSS 样式类。
 * @param {number} score - 综合评测得分 (0~100)
 * @returns {string} score-level-excellent | score-level-good | score-level-pass | score-level-low
 */
export function getScoreLevelClass(score) {
    if (typeof score !== "number" || isNaN(score) || score <= 0) return "score-level-low";
    if (score >= 80) return "score-level-excellent";
    if (score >= 70) return "score-level-good";
    if (score >= 60) return "score-level-pass";
    return "score-level-low";
}
