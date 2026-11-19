/**
 * table_resizer.js
 * 表格列宽智能自适应、手动拖拽拉伸与持久化存储模块。
 * 
 * 核心功能：
 * 1. 默认自适应：依据列内最大文本内容的物理宽度自动计算分配列宽；
 * 2. 手动拖拽调整：表头右侧边框支持高精度拖拽拉伸与缩减；
 * 3. 状态持久化：用户调整后的列宽实时保存至 localStorage，重新加载时无缝恢复；
 * 4. 便捷重置：双击列分隔条即可将该列重置为默认自适应宽度。
 */

import { showToast } from "./utils.js";
import { t } from "./i18n/i18n.js";

// 离屏 Canvas 画布，用于无重排 (Reflow-free) 高性能亚毫秒级测量文本物理像素宽度
let measureCanvas = null;
let measureCtx = null;

/**
 * 测量指定文本在特定字体下的物理像素宽度。
 * @param {string} text - 待测量的文本内容
 * @param {string} font - Canvas 字体样式描述符
 * @returns {number} 物理像素宽度
 */
function getTextWidth(text, font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif') {
    if (!text) return 0;
    if (!measureCanvas) {
        measureCanvas = document.createElement("canvas");
        measureCtx = measureCanvas.getContext("2d");
    }
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
}

/**
 * 测速基准排行榜表格列宽基线配置。
 * min: 最小物理宽度; maxCap: 自适应上限封顶值; default: 初始基准宽度。
 */
export const BENCHMARK_COL_CONFIGS = {
    rank: { min: 46, maxCap: 65, default: 56 },
    airport: { min: 80, maxCap: 140, default: 95 },
    node_name: { min: 160, maxCap: 300, default: 260 },
    ping: { min: 90, maxCap: 130, default: 105 },
    availability: { min: 110, maxCap: 160, default: 135 },
    ttfb: { min: 75, maxCap: 115, default: 90 },
    ttft: { min: 75, maxCap: 115, default: 90 },
    tps: { min: 85, maxCap: 130, default: 105 },
    jitter: { min: 95, maxCap: 170, default: 125 },
    ingress: { min: 110, maxCap: 165, default: 135 },
    score: { min: 75, maxCap: 110, default: 95 }
};

/**
 * 节点抽屉列表表格列宽基线配置。
 */
export const NODES_COL_CONFIGS = {
    select: { min: 40, maxCap: 48, default: 42 },
    index: { min: 40, maxCap: 55, default: 44 },
    node_name: { min: 150, maxCap: 280, default: 220 },
    type: { min: 75, maxCap: 110, default: 85 },
    server: { min: 130, maxCap: 220, default: 160 },
    ping: { min: 75, maxCap: 115, default: 95 },
    score: { min: 75, maxCap: 110, default: 90 },
    availability: { min: 100, maxCap: 150, default: 120 },
    ttfb: { min: 75, maxCap: 115, default: 90 },
    ttft: { min: 75, maxCap: 115, default: 90 },
    tps: { min: 85, maxCap: 130, default: 105 },
    jitter: { min: 95, maxCap: 170, default: 125 },
    ingress: { min: 110, maxCap: 165, default: 135 },
    time: { min: 120, maxCap: 180, default: 150 }
};

/**
 * 获取本地持久化的表格列宽映射表。
 * @param {string} storageKey - localStorage 存储键名
 * @returns {Object} 列键到宽度的映射字典
 */
export function getSavedColumnWidths(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * 持久化保存用户手动调整的表格列宽。
 * @param {string} storageKey - localStorage 存储键名
 * @param {Object} widths - 列键到宽度的映射字典
 */
export function setSavedColumnWidths(storageKey, widths) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch (e) {
        console.warn("Failed to save column widths:", e);
    }
}

/**
 * 根据内容最大宽度与持久化配置动态应用表格各列的宽度。
 * @param {HTMLTableElement} table - 目标表格 DOM 元素
 * @param {string} storageKey - localStorage 存储键名
 * @param {Object} colConfigs - 列宽基线配置字典
 */
export function applyTableColumnWidths(table, storageKey, colConfigs = BENCHMARK_COL_CONFIGS) {
    if (!table) return;

    const savedWidths = getSavedColumnWidths(storageKey);
    const thList = table.querySelectorAll("thead tr th");
    if (!thList || thList.length === 0) return;

    let totalWidth = 0;

    thList.forEach((th, idx) => {
        const colKey = th.getAttribute("data-col") || `col_${idx}`;
        const cfg = colConfigs[colKey] || { min: 60, maxCap: 260, default: 100 };

        let finalWidth = 0;

        if (typeof savedWidths[colKey] === "number" && savedWidths[colKey] > 0) {
            // 1. 优先读取用户历史手动调整的列宽
            finalWidth = savedWidths[colKey];
        } else {
            // 2. 默认自适应：计算最大内容宽度（表头 + 可见数据行单元格）
            const headerLabel = th.innerText.trim().split("\n")[0] || "";
            let maxContentWidth = getTextWidth(headerLabel) + 36; // 包含排序/提示图标与内边距

            // 扫描该列所有可见的数据行单元格
            const cells = table.querySelectorAll(`tbody tr td:nth-child(${idx + 1})`);
            cells.forEach(td => {
                const cellText = (td.innerText || "").trim();
                if (!cellText) return;
                const textW = getTextWidth(cellText) + 26; // 单元格内边距与边框偏移量
                if (textW > maxContentWidth) {
                    maxContentWidth = textW;
                }
            });

            // 钳制在 [cfg.min, cfg.maxCap] 区间内
            finalWidth = Math.round(Math.min(Math.max(cfg.min, maxContentWidth), cfg.maxCap));
        }

        th.style.width = `${finalWidth}px`;
        th.style.minWidth = `${finalWidth}px`;
        totalWidth += finalWidth;
    });

    // 确保在宽屏下表格拉伸至 100%，超出时启用平滑横向滚动
    const wrapper = table.closest(".table-wrapper");
    const wrapperWidth = wrapper ? wrapper.clientWidth : 0;
    if (totalWidth > wrapperWidth && wrapperWidth > 0) {
        table.style.width = `${totalWidth}px`;
    } else {
        table.style.width = "100%";
    }
}

/**
 * 初始化表格列拖拽调整句柄与双击重置监听器。
 * @param {HTMLTableElement} table - 目标表格 DOM 元素
 * @param {string} storageKey - localStorage 存储键名
 * @param {Object} colConfigs - 列宽基线配置字典
 */
export function initTableColumnResizer(table, storageKey, colConfigs = BENCHMARK_COL_CONFIGS) {
    if (!table) return;

    const thList = table.querySelectorAll("thead tr th");
    if (!thList || thList.length === 0) return;

    thList.forEach((th, idx) => {
        const colKey = th.getAttribute("data-col") || `col_${idx}`;
        const cfg = colConfigs[colKey] || { min: 50, maxCap: 300, default: 100 };

        // 避免重复创建拖拽手柄
        let resizer = th.querySelector(".col-resizer");
        if (!resizer) {
            resizer = document.createElement("div");
            resizer.className = "col-resizer";
            resizer.title = t("table_resizer.tooltip", {}, "↔ Drag to resize, double-click to reset width");
            th.appendChild(resizer);
        }

        // 鼠标按下：开始拖拽调整
        resizer.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.pageX;
            const startWidth = th.getBoundingClientRect().width;

            resizer.classList.add("is-resizing");
            document.body.classList.add("resizing-col");

            function onMouseMove(moveEvent) {
                moveEvent.preventDefault();
                const deltaX = moveEvent.pageX - startX;
                const newWidth = Math.max(cfg.min, Math.round(startWidth + deltaX));

                th.style.width = `${newWidth}px`;
                th.style.minWidth = `${newWidth}px`;

                // 实时更新表格整体宽度
                const wrapper = table.closest(".table-wrapper");
                const currentThs = table.querySelectorAll("thead tr th");
                let sumWidth = 0;
                currentThs.forEach(t => sumWidth += t.getBoundingClientRect().width);
                if (wrapper && sumWidth > wrapper.clientWidth) {
                    table.style.width = `${sumWidth}px`;
                } else {
                    table.style.width = "100%";
                }
            }

            function onMouseUp() {
                resizer.classList.remove("is-resizing");
                document.body.classList.remove("resizing-col");
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);

                // 持久化保存最新的列宽映射
                const currentSaved = getSavedColumnWidths(storageKey);
                const actualWidth = Math.round(th.getBoundingClientRect().width);
                currentSaved[colKey] = actualWidth;
                setSavedColumnWidths(storageKey, currentSaved);
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };

        // 双击手柄：将该列重置为默认自适应宽度
        resizer.ondblclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentSaved = getSavedColumnWidths(storageKey);
            delete currentSaved[colKey];
            setSavedColumnWidths(storageKey, currentSaved);

            applyTableColumnWidths(table, storageKey, colConfigs);
            const colName = th.innerText.trim().split("\n")[0] || t("table_resizer.col_fallback", {}, "Current");
            showToast(t("table_resizer.toast_reset", { col: colName }, `✨ Reset column "${colName}" to default width`));
        };
    });

    // 初次加载时应用列宽
    applyTableColumnWidths(table, storageKey, colConfigs);
}
