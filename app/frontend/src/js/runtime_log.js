/**
 * runtime_log.js
 * AIDF 核心运行时诊断日志右侧滑出抽屉 (Slide-over Drawer) 控制器。
 */

import { showToast } from "./utils.js";
import { t } from "./i18n/i18n.js";

/**
 * 对 HTML 特殊字符进行转义，防御 XSS 跨站脚本攻击。
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的安全字符串
 */
export function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 依据日志级别对单行日志进行高亮语法着色。
 * @param {string} line - 单行日志文本
 * @returns {string} 带有样式标记的 HTML 片段
 */
export function highlightLogLine(line) {
    const escaped = escapeHtml(line);
    if (escaped.includes("[ERROR]")) {
        return `<span style="color: #f87171; font-weight: 600;">${escaped}</span>`;
    } else if (escaped.includes("[WARN]")) {
        return `<span style="color: #fbbf24;">${escaped}</span>`;
    } else if (escaped.includes("[INFO]")) {
        if (escaped.toLowerCase().includes("success")) {
            return `<span style="color: #4ade80;">${escaped}</span>`;
        }
        return `<span style="color: #94a3b8;">${escaped}</span>`;
    } else if (escaped.includes("[DEBUG]")) {
        return `<span style="color: #a855f7;">${escaped}</span>`;
    }
    return `<span>${escaped}</span>`;
}

/**
 * 初始化运行时日志抽屉的交互事件监听、自动刷新及渲染机制。
 */
export function initRuntimeLogDrawer() {
    const btnTopBar = document.getElementById("btn-topbar-log");
    const btnSettingsOpen = document.getElementById("btn-open-runtime-log");
    const btnOpenLogDir = document.getElementById("btn-open-log-dir");
    const btnDrawerOpenLogDir = document.getElementById("btn-drawer-open-log-dir");
    const btnCopyPath = document.getElementById("btn-copy-log-path");

    const overlay = document.getElementById("modal-runtime-log");
    const backdrop = document.getElementById("drawer-runtime-log-backdrop");
    const btnClose = document.getElementById("btn-close-runtime-log");

    const btnRefresh = document.getElementById("btn-refresh-runtime-log");
    const btnCopy = document.getElementById("btn-copy-runtime-log");
    const btnCopyFilepath = document.getElementById("btn-copy-log-filepath");
    const preContent = document.getElementById("runtime-log-content");
    const pathDisplay = document.getElementById("runtime-log-path-display");
    const timeDisplay = document.getElementById("runtime-log-time-display");
    const chkAutoScroll = document.getElementById("chk-auto-scroll-log");
    const chkAutoRefresh = document.getElementById("chk-auto-refresh-log");

    let currentLogPath = "";
    let rawLogText = "";
    let autoRefreshTimer = null;
    const AUTO_REFRESH_INTERVAL_MS = 1500;

    function startAutoRefresh() {
        stopAutoRefresh();
        if (chkAutoRefresh && !chkAutoRefresh.checked) {
            return;
        }
        autoRefreshTimer = setInterval(async () => {
            // 保护卫语句：若抽屉处于隐藏或关闭状态，则立即终止轮询
            if (!overlay || overlay.classList.contains("hidden") || !overlay.classList.contains("drawer-open")) {
                stopAutoRefresh();
                return;
            }
            await refreshLogs(false);
        }, AUTO_REFRESH_INTERVAL_MS);
    }

    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    async function openDrawer() {
        if (!overlay) return;
        overlay.classList.remove("hidden");
        requestAnimationFrame(() => {
            overlay.classList.add("drawer-open");
        });
        await refreshLogs(true);
        startAutoRefresh();
    }

    function closeDrawer() {
        stopAutoRefresh();
        if (!overlay) return;
        overlay.classList.remove("drawer-open");
        setTimeout(() => {
            overlay.classList.add("hidden");
        }, 280);
    }

    async function refreshLogs(isManual = false) {
        if (!preContent) return;
        try {
            if (window.go && window.go.main && window.go.main.App) {
                if (window.go.main.App.GetRuntimeLogPath) {
                    currentLogPath = await window.go.main.App.GetRuntimeLogPath();
                    if (pathDisplay) {
                        const notConfigured = t("runtime_log.not_configured", {}, "Not Configured");
                        pathDisplay.innerText = t("runtime_log.log_file", { path: currentLogPath || notConfigured }, `Log File: ${currentLogPath || notConfigured}`);
                        pathDisplay.title = currentLogPath;
                    }
                }
                if (window.go.main.App.GetRecentLogs) {
                    const newLogText = await window.go.main.App.GetRecentLogs(300);
                    if (newLogText !== rawLogText || isManual) {
                        rawLogText = newLogText;
                        renderHighlightedLogs(rawLogText);
                    }
                } else {
                    preContent.innerText = t("runtime_log.err_no_interface", {}, "Backend GetRecentLogs interface not available");
                }
            } else {
                preContent.innerText = t("runtime_log.err_wails_not_ready", {}, "Wails runtime environment not ready");
            }
            if (timeDisplay) {
                const now = new Date();
                timeDisplay.innerText = t("runtime_log.last_refresh", { time: now.toLocaleTimeString() }, `Last Refreshed: ${now.toLocaleTimeString()}`);
            }
        } catch (err) {
            preContent.innerText = t("runtime_log.err_read_failed", { error: err }, "Failed to read runtime logs: " + err);
        }
    }

    function renderHighlightedLogs(text) {
        if (!preContent) return;
        if (!text || text.trim() === "") {
            preContent.innerHTML = `<span style="color: #64748b;">${t("runtime_log.empty_logs", {}, "(No runtime logs yet. Outbound connections, handshakes, and errors will be recorded here during benchmark)")}</span>`;
            return;
        }

        const lines = text.split("\n");
        const htmlLines = lines.map(line => highlightLogLine(line));

        preContent.innerHTML = htmlLines.join("\n");

        if (chkAutoScroll && chkAutoScroll.checked) {
            const body = preContent.parentElement;
            if (body) {
                body.scrollTop = body.scrollHeight;
            }
        }
    }

    // 事件监听绑定
    if (btnTopBar) btnTopBar.addEventListener("click", openDrawer);
    if (btnSettingsOpen) btnSettingsOpen.addEventListener("click", openDrawer);
    if (btnClose) btnClose.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay && overlay.classList.contains("drawer-open")) {
            closeDrawer();
        }
    });

    if (chkAutoRefresh) {
        chkAutoRefresh.addEventListener("change", () => {
            if (chkAutoRefresh.checked) {
                refreshLogs(false);
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            btnRefresh.disabled = true;
            await refreshLogs(true);
            btnRefresh.disabled = false;
            showToast(t("runtime_log.toast_refreshed", {}, "✅ Logs refreshed"));
            if (chkAutoRefresh && chkAutoRefresh.checked) {
                startAutoRefresh();
            }
        });
    }

    if (btnCopy) {
        btnCopy.addEventListener("click", () => {
            if (!rawLogText) {
                showToast(t("runtime_log.toast_no_logs_to_copy", {}, "⚠️ No logs available to copy"));
                return;
            }
            navigator.clipboard.writeText(rawLogText).then(() => {
                showToast(t("runtime_log.toast_copied", {}, "📋 Runtime logs copied to clipboard"));
            }).catch(err => {
                showToast(t("runtime_log.toast_copy_failed", { error: err }, "❌ Copy failed: " + err));
            });
        });
    }

    const copyPathAction = () => {
        if (!currentLogPath) {
            showToast(t("runtime_log.toast_invalid_path", {}, "⚠️ No valid log path found"));
            return;
        }
        navigator.clipboard.writeText(currentLogPath).then(() => {
            showToast(t("runtime_log.toast_path_copied", {}, "📂 Absolute log path copied to clipboard"));
        }).catch(err => {
            showToast(t("runtime_log.toast_copy_failed", { error: err }, "❌ Copy failed: " + err));
        });
    };

    const openLogDirAction = async () => {
        try {
            if (window.go && window.go.main && window.go.main.App && window.go.main.App.OpenLogDir) {
                await window.go.main.App.OpenLogDir();
                showToast(t("runtime_log.toast_opened_dir", {}, "📂 Log directory opened in file explorer"));
            } else {
                showToast(t("runtime_log.toast_env_not_ready", {}, "⚠️ Environment not ready or OpenLogDir interface unavailable"));
            }
        } catch (err) {
            showToast(t("runtime_log.toast_open_dir_failed", { error: err }, "❌ Failed to open log directory: " + err));
        }
    };

    if (btnCopyPath) btnCopyPath.addEventListener("click", copyPathAction);
    if (btnCopyFilepath) btnCopyFilepath.addEventListener("click", copyPathAction);
    if (btnOpenLogDir) btnOpenLogDir.addEventListener("click", openLogDirAction);
    if (btnDrawerOpenLogDir) btnDrawerOpenLogDir.addEventListener("click", openLogDirAction);

    // 若用户在系统设置面板中点击“查看日志”，同时触发打开日志目录与展开抽屉
    if (btnSettingsOpen) {
        btnSettingsOpen.addEventListener("click", () => {
            openLogDirAction();
        });
    }
}
