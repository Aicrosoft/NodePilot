/**
 * theme.js
 * 浅色/深色双主题与跟随系统的自适应主题切换控制器。
 */

const STORAGE_KEY_THEME = "nodepilot_theme_mode_v1";

// 主题模式选项: 'auto' (跟随系统) | 'light' (浅色) | 'dark' (深色)
let currentThemeMode = "auto";

/**
 * 获取当前主题模式。
 * @returns {string} 当前激活的主题模式 ('auto' | 'light' | 'dark')
 */
export function getThemeMode() {
    return currentThemeMode;
}

/**
 * 从 localStorage 初始化主题配置并绑定系统主题变更事件监听器。
 */
export function initTheme() {
    // 1. 从 localStorage 恢复主题模式，默认采用 'auto'
    try {
        const saved = localStorage.getItem(STORAGE_KEY_THEME);
        if (saved && (saved === "light" || saved === "dark" || saved === "auto")) {
            currentThemeMode = saved;
        } else {
            currentThemeMode = "auto";
        }
    } catch (e) {
        currentThemeMode = "auto";
    }

    // 2. 监听系统色彩模式变更事件（当处于 'auto' 模式时自动响应切换）
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", () => {
        if (currentThemeMode === "auto") {
            applyResolvedTheme("auto");
        }
    });

    // 3. 绑定分段式主题切换控制器的点击事件
    const themeControl = document.getElementById("theme-control");
    if (themeControl) {
        const btns = themeControl.querySelectorAll(".theme-seg-btn");
        btns.forEach(btn => {
            btn.addEventListener("click", () => {
                const targetMode = btn.getAttribute("data-theme-val");
                if (targetMode) {
                    setThemeMode(targetMode);
                }
            });
        });
    }

    // 4. 初次加载时应用主题
    applyResolvedTheme(currentThemeMode);
}

/**
 * 设置并持久化主题模式配置。
 * @param {'light'|'dark'|'auto'} mode - 目标主题模式
 */
export function setThemeMode(mode) {
    if (mode !== "light" && mode !== "dark" && mode !== "auto") return;
    currentThemeMode = mode;
    try {
        localStorage.setItem(STORAGE_KEY_THEME, mode);
    } catch (e) {
        console.error("Failed to save theme preference:", e);
    }
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAppSetting) {
        window.go.main.App.SaveAppSetting(STORAGE_KEY_THEME, mode).catch(e => {});
    }
    applyResolvedTheme(mode);
}

/**
 * 计算最终激活的主题（浅色或深色），并应用至文档根节点与原生应用窗口。
 * @param {'light'|'dark'|'auto'} mode - 待解析的主题模式
 */
function applyResolvedTheme(mode) {
    let resolved = mode;
    if (mode === "auto") {
        const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        resolved = isSystemDark ? "dark" : "light";
    }

    // 设置 html 根节点的 data-theme 属性
    document.documentElement.setAttribute("data-theme", resolved);

    // 同步原生窗口标题栏与背景底色（兼容 macOS / Windows 原生标题栏样式）
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetNativeTheme) {
        try {
            window.go.main.App.SetNativeTheme(resolved);
        } catch (e) {
            console.warn("Failed to sync native window titlebar theme:", e);
        }
    }

    // 同步分段控制器按钮的高亮激活状态
    const themeControl = document.getElementById("theme-control");
    if (themeControl) {
        const btns = themeControl.querySelectorAll(".theme-seg-btn");
        btns.forEach(btn => {
            if (btn.getAttribute("data-theme-val") === mode) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }
}
