/**
 * i18n.js
 * 轻量级原生国际化 (i18n) 引擎。
 * 
 * 核心特性：
 * 1. 默认跟随系统 ("auto")：智能匹配宿主系统语言，非中文环境默认采用英文；
 * 2. 点分隔深层路径解析与动态参数插值 ({param})；
 * 3. 声明式 DOM 自动化批量翻译 ([data-i18n], [data-i18n-title], [data-i18n-placeholder])；
 * 4. 零刷新平滑动态切换与全局事件广播通知。
 */

import zh from "./locales/zh.js";
import en from "./locales/en.js";

const STORAGE_KEY_LANG = "nodepilot_display_language";
const dictionaries = { zh, en };
const listeners = new Set();

let currentSetting = "auto"; // "auto" | "zh" | "en"
let currentEffectiveLang = "en"; // "zh" | "en"

/**
 * 探测宿主操作系统/浏览器的语言偏好：若为中文环境则返回 "zh"，其余默认返回 "en"。
 * @returns {"zh" | "en"}
 */
export function detectSystemLanguage() {
    if (typeof navigator === "undefined") {
        const envLang = (typeof process !== "undefined" && process.env && (process.env.LANG || process.env.LC_ALL)) || "";
        return envLang.toLowerCase().startsWith("zh") ? "zh" : "en";
    }
    const navLangs = navigator.languages || [navigator.language || navigator.userLanguage || ""];
    for (const l of navLangs) {
        const lower = (l || "").toLowerCase();
        if (lower.startsWith("zh")) {
            return "zh";
        }
    }
    // 默认回退至英文
    return "en";
}

/**
 * 根据点分隔路径安全读取深层嵌套对象的属性值。
 * @param {Object} obj - 目标对象
 * @param {string} path - 点分隔路径，例如 "nav.benchmark"
 * @returns {string|null} 检索到的文本内容或 null
 */
export function getNestedValue(obj, path) {
    if (!obj || !path) return null;
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
            current = current[part];
        } else {
            return null;
        }
    }
    return typeof current === "string" ? current : null;
}

/**
 * 检索国际化翻译文本，并执行动态模板参数插值替换。
 * @param {string} key - 字典键名，例如 "sidebar.ready_status"
 * @param {Object} [params] - 动态插值参数字典，例如 { nodes: 10 }
 * @param {string} [fallback] - 未匹配到对应键时的默认兜底回退文本
 * @returns {string} 插值替换后的最终显示文本
 */
export function t(key, params = {}, fallback = "") {
    const dict = dictionaries[currentEffectiveLang] || dictionaries.en;
    let text = getNestedValue(dict, key);

    // 回退至英文语言包
    if (text === null && currentEffectiveLang !== "en") {
        text = getNestedValue(dictionaries.en, key);
    }
    // 回退至中文语言包
    if (text === null && currentEffectiveLang !== "zh") {
        text = getNestedValue(dictionaries.zh, key);
    }

    if (text === null) {
        return fallback || key;
    }

    // 执行 {variable} 变量参数模板插值
    if (params && typeof params === "object") {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
        }
    }

    return text;
}

/**
 * 获取当前生效的语言代码 ("zh" | "en")。
 * @returns {"zh" | "en"}
 */
export function getCurrentLanguage() {
    return currentEffectiveLang;
}

/**
 * 获取用户配置的语言模式设定 ("auto" | "zh" | "en")。
 * @returns {"auto" | "zh" | "en"}
 */
export function getCurrentLanguageSetting() {
    return currentSetting;
}

/**
 * 切换全局语言设置并立即刷新 DOM 界面。
 * @param {"auto" | "zh" | "en"} setting - 目标语言设定
 */
export function setLanguage(setting) {
    if (setting !== "auto" && setting !== "zh" && setting !== "en") {
        setting = "auto";
    }

    currentSetting = setting;
    localStorage.setItem(STORAGE_KEY_LANG, setting);
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAppSetting) {
        window.go.main.App.SaveAppSetting(STORAGE_KEY_LANG, setting).catch(e => {});
    }

    if (setting === "auto") {
        currentEffectiveLang = detectSystemLanguage();
    } else {
        currentEffectiveLang = setting;
    }

    // 更新 html 根节点的 lang 属性
    document.documentElement.lang = (currentEffectiveLang === "zh") ? "zh-CN" : "en-US";

    // 更新文档标题以及 Wails 原生窗口标题
    const winTitle = t("app.window_title");
    if (winTitle && winTitle !== "app.window_title") {
        document.title = winTitle;
        if (window.runtime && typeof window.runtime.WindowSetTitle === "function") {
            window.runtime.WindowSetTitle(winTitle);
        }
    }

    // 翻译 DOM 树中所有带有 data-i18n* 属性的元素
    translateDOM();

    // 同步更新语言切换控件的高亮激活状态
    updateLanguageControls(currentSetting);

    // 通知所有已注册的语言变更回调监听器
    listeners.forEach(fn => {
        try {
            fn(currentEffectiveLang, currentSetting);
        } catch (e) {
            console.error("i18n listener error:", e);
        }
    });
}

/**
 * 注册全局语言变更监听器。
 * @param {Function} callback - 回调函数 (effectiveLang, setting) => void
 */
export function onLanguageChange(callback) {
    if (typeof callback === "function") {
        listeners.add(callback);
    }
}

/**
 * 深度遍历并翻译 DOM 容器内所有带有声明式国际化标记的元素。
 * @param {HTMLElement|Document} [root=document] - 遍历的根 DOM 节点，默认指向 document
 */
export function translateDOM(root = document) {
    const getElements = (selector) => {
        const list = Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []);
        if (root.matches && root.matches(selector)) {
            list.push(root);
        }
        return list;
    };

    // 1. 文本内容与 HTML 标记: data-i18n
    getElements("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (key) {
            const translated = t(key);
            if (translated && translated !== key) {
                if (el.tagName === "OPTION") {
                    el.text = translated;
                } else if (translated.includes("<") && translated.includes(">")) {
                    el.innerHTML = translated;
                } else {
                    el.innerText = translated;
                }
            }
        }
    });

    // 2. 悬浮提示文本: data-i18n-title
    getElements("[data-i18n-title]").forEach(el => {
        const key = el.getAttribute("data-i18n-title");
        if (key) {
            const translated = t(key);
            if (translated && translated !== key) {
                el.title = translated;
            }
        }
    });

    // 3. 输入框占位文本: data-i18n-placeholder
    getElements("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (key) {
            const translated = t(key);
            if (translated && translated !== key) {
                el.placeholder = translated;
            }
        }
    });
}

/**
 * 更新界面语言切换按钮及下拉选择框的高亮激活状态。
 * @param {string} setting - 当前语言设置 ("auto" | "zh" | "en")
 */
function updateLanguageControls(setting) {
    // 侧边栏分段切换按钮
    const langBtns = document.querySelectorAll(".lang-seg-btn");
    langBtns.forEach(btn => {
        const val = btn.getAttribute("data-lang");
        btn.classList.toggle("active", val === setting);
    });

    // 设置面板语言下拉选择框
    const select = document.getElementById("settings-display-lang");
    if (select) {
        select.value = setting;
    }
}

/**
 * 初始化国际化核心子系统。
 */
export function initI18n() {
    let saved = localStorage.getItem(STORAGE_KEY_LANG);
    if (!saved || (saved !== "auto" && saved !== "zh" && saved !== "en")) {
        saved = "auto";
    }

    // 绑定侧边栏语言切换分段按钮
    const langControl = document.getElementById("lang-control");
    if (langControl) {
        langControl.querySelectorAll(".lang-seg-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetLang = btn.getAttribute("data-lang");
                if (targetLang && targetLang !== currentSetting) {
                    setLanguage(targetLang);
                }
            });
        });
    }

    // 绑定设置面板语言下拉选择框
    const settingsLangSelect = document.getElementById("settings-display-lang");
    if (settingsLangSelect) {
        settingsLangSelect.addEventListener("change", (e) => {
            const targetLang = e.target.value;
            if (targetLang && targetLang !== currentSetting) {
                setLanguage(targetLang);
            }
        });
    }

    // 监听浏览器系统语言变动事件
    window.addEventListener("languagechange", () => {
        if (currentSetting === "auto") {
            setLanguage("auto");
        }
    });

    setLanguage(saved);
}

/**
 * 动态同步更新各语言包字典及 UI 中权威的应用版本号。
 * @param {string} version - 应用版本字符串，例如 "0.1.26111501" 或 "v0.1.26111501"
 */
export function setAppVersion(version) {
    if (!version) return;
    const formatted = version.startsWith("v") ? version : `v${version}`;
    if (zh && zh.app) zh.app.version = formatted;
    if (en && en.app) en.app.version = formatted;
    if (typeof document !== "undefined") {
        const verEl = document.getElementById("sidebar-app-version");
        if (verEl) {
            verEl.innerText = formatted;
        }
    }
}
