/**
 * airport_backup.js
 * 机场与节点配置的一键导出备份、本地/外部文件读取、校验解析与智能合并导入控制器。
 */

import {
    getStoredAirports,
    saveStoredAirports,
    saveStoredSelectedAirportIds
} from "./store.js";
import {
    showToast,
    formatNow,
    formatFullDateTime,
    openConfirmModal
} from "./utils.js";
import { applyNodeFilters } from "./node_filter.js";
import { updateSidebarCounters } from "./sidebar.js";
import { t } from "./i18n/i18n.js";

/**
 * 构建标准化的机场与节点备份 JSON 数据载荷。
 * @param {Array} airports - 当前机场列表
 * @returns {Object} 包含版本号、导出时间与标准化机场数据的载荷对象
 */
export function createBackupPayload(airports = []) {
    const list = Array.isArray(airports) ? airports : [];
    let totalNodes = 0;
    const cleanAirports = list.map(ap => {
        const rawNodes = (Array.isArray(ap.rawNodes) && ap.rawNodes.length > 0)
            ? ap.rawNodes
            : (Array.isArray(ap.nodes) ? ap.nodes : []);
        totalNodes += rawNodes.length;

        return {
            id: ap.id,
            name: ap.name,
            type: ap.type || "url",
            url: ap.url || "",
            filePath: ap.filePath || "",
            filterRules: ap.filterRules || null,
            rawNodes: rawNodes,
            nodes: (Array.isArray(ap.nodes) && ap.nodes.length > 0) ? ap.nodes : rawNodes,
            totalNodeCount: ap.totalNodeCount || rawNodes.length,
            nodeCount: ap.nodeCount || rawNodes.length,
            status: ap.status || "ok",
            updatedAt: ap.updatedAt || formatNow()
        };
    });

    return {
        version: "1.0",
        app: "NodePilot",
        exportTime: formatFullDateTime(new Date()),
        totalAirports: cleanAirports.length,
        totalNodes: totalNodes,
        airports: cleanAirports
    };
}

/**
 * 严格校验导入的备份 JSON 文本格式及其内部数据结构。
 * @param {string} jsonContent - 备份 JSON 文本
 * @returns {{ valid: boolean, error?: string, version?: string, exportTime?: string, airports?: Array, totalAirports?: number }} 校验结果对象
 */
export function validateBackupPayload(jsonContent) {
    if (!jsonContent || typeof jsonContent !== "string" || !jsonContent.trim()) {
        return { valid: false, error: "Empty backup content" };
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (err) {
        return { valid: false, error: "Invalid JSON: " + err.message };
    }

    let airports = null;
    let version = null;
    let exportTime = null;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        version = parsed.version || null;
        exportTime = parsed.exportTime || null;
        if (Array.isArray(parsed.airports)) {
            airports = parsed.airports;
        }
    } else if (Array.isArray(parsed)) {
        airports = parsed;
    }

    if (!airports) {
        return { valid: false, error: "Missing airports array in backup structure" };
    }

    if (airports.length === 0) {
        return { valid: false, error: "Backup contains empty airports list" };
    }

    return {
        valid: true,
        version: version || "1.0",
        exportTime: exportTime,
        airports: airports,
        totalAirports: airports.length
    };
}

/**
 * 智能合并当前工作区已有机场与新导入的机场配置。
 * 合并策略：同名机场保留既有稳定唯一 ID 并更新节点与过滤规则，其余新增机场追加至尾部。
 * @param {Array} currentAirports - 当前已存在的机场列表
 * @param {Array} importedAirports - 待合并的新导入机场列表
 * @returns {Array} 智能合并后的最终机场数组
 */
export function mergeAirports(currentAirports = [], importedAirports = []) {
    const airportMap = new Map();
    (currentAirports || []).forEach(a => airportMap.set(a.name, { ...a }));

    (importedAirports || []).forEach(imp => {
        const clonedImp = { ...imp };
        if (airportMap.has(clonedImp.name)) {
            const existing = airportMap.get(clonedImp.name);
            clonedImp.id = existing.id; // 保持既有稳定的唯一 ID
        }
        airportMap.set(clonedImp.name, clonedImp);
    });

    return Array.from(airportMap.values());
}

/**
 * 导出工作区中全部机场及其绑定的过滤规则与节点配置。
 */
export async function exportAllAirports() {
    const airports = getStoredAirports();
    if (!airports || airports.length === 0) {
        showToast(t("backup.alert_no_airports", {}, "⚠️ No airport configurations available to export"), "warning");
        return;
    }

    const exportPayload = createBackupPayload(airports);
    const totalNodes = exportPayload.totalNodes;
    const cleanAirports = exportPayload.airports;

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const dateStr = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const defaultFilename = `nodepilot_airports_${dateStr}.json`;

    // 1. 优先调用 Wails 原生桌面保存文件弹窗
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.ExportAirportsConfig) {
        try {
            const savedPath = await window.go.main.App.ExportAirportsConfig(jsonString, defaultFilename);
            if (savedPath) {
                showToast(t("backup.toast_exported_path", { count: cleanAirports.length, nodes: totalNodes, path: savedPath }, `💾 Exported ${cleanAirports.length} airports (${totalNodes} nodes) to: ${savedPath}`));
            }
            return;
        } catch (err) {
            console.warn("Native file save dialog failed, falling back to browser download:", err);
        }
    }

    // 2. 降级回退至标准浏览器 Blob 下载方案
    try {
        const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(t("backup.toast_exported_web", { count: cleanAirports.length, nodes: totalNodes }, `💾 Exported ${cleanAirports.length} airport configs (${totalNodes} nodes)!`));
    } catch (e) {
        alert(t("backup.alert_export_fail", { error: e.message }, "Failed to export file: " + e.message));
    }
}

/**
 * 从外部文件导入机场及其节点配置。
 * @param {Object} context - UI 交互上下文与各级渲染回调函数
 */
export async function importAllAirports(context) {
    let jsonContent = "";

    // 1. 优先拉起 Wails 原生文件选择对话框
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SelectImportAirportsFile) {
        try {
            const filePath = await window.go.main.App.SelectImportAirportsFile();
            if (!filePath) return; // 用户取消了选择
            jsonContent = await window.go.main.App.ReadImportAirportsFile(filePath);
        } catch (err) {
            console.warn("Native file selector failed, falling back to file input element:", err);
        }
    }

    // 2. 降级回退至隐藏的 HTML 文件输入元素触发读取
    if (!jsonContent) {
        const fileInput = document.getElementById("input-import-airports-file");
        if (fileInput) {
            fileInput.value = "";
            fileInput.onchange = (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    executeImportAirports(event.target.result, context);
                };
                reader.readAsText(file);
            };
            fileInput.click();
            return;
        }
    }

    executeImportAirports(jsonContent, context);
}

/**
 * 执行机场备份数据的解析校验、数据标准化及智能合并入库。
 * @param {string} jsonContent - 导入文件的 JSON 字符串
 * @param {Object} context - UI 交互上下文与各级渲染回调函数
 */
export function executeImportAirports(jsonContent, context = {}) {
    const valRes = validateBackupPayload(jsonContent);
    if (!valRes.valid) {
        if (!jsonContent || !jsonContent.trim()) {
            showToast(t("backup.toast_import_empty", {}, "⚠️ Imported file is empty"), "warning");
        } else if (valRes.error && valRes.error.startsWith("Invalid JSON")) {
            alert(t("backup.alert_json_invalid", { error: valRes.error }, "Failed to parse import: Invalid JSON format\n" + valRes.error));
        } else if (valRes.error && valRes.error.includes("Missing airports")) {
            alert(t("backup.alert_no_airports_array", {}, "Unrecognized format: Missing airports array in JSON"));
        } else {
            showToast(t("backup.toast_no_airports", {}, "⚠️ Imported file does not contain any airports"), "warning");
        }
        return;
    }

    const importedAirports = valRes.airports;

    // 校验并清洗导入数据，自动应用内部包含的节点过滤规则
    let totalImportedNodes = 0;
    const validatedAirports = importedAirports.map((ap, idx) => {
        const id = ap.id || (Date.now() + idx).toString();
        const name = (ap.name || "").trim() || t("backup.default_imported_name", { num: idx + 1 }, `Imported Airport ${idx + 1}`);
        const rawNodes = (Array.isArray(ap.rawNodes) && ap.rawNodes.length > 0)
            ? ap.rawNodes
            : (Array.isArray(ap.nodes) ? ap.nodes : []);

        const filterRules = ap.filterRules || null;
        const filteredNodes = applyNodeFilters(rawNodes, filterRules);

        totalImportedNodes += rawNodes.length;

        return {
            id: id,
            name: name,
            type: ap.type || (ap.url ? "url" : "file"),
            url: ap.url || "",
            filePath: ap.filePath || "",
            filterRules: filterRules,
            rawNodes: rawNodes,
            nodes: filteredNodes,
            totalNodeCount: rawNodes.length,
            nodeCount: filteredNodes.length,
            status: ap.status || "ok",
            updatedAt: ap.updatedAt || formatNow()
        };
    });

    const currentAirports = getStoredAirports();

    // 核心合并入库与数据持久化逻辑
    const doMergeAndSave = () => {
        const mergedAirports = mergeAirports(currentAirports, validatedAirports);

        // 自动勾选包含有效节点的导入机场
        if (context.selectedAirportIds) {
            validatedAirports.forEach(a => {
                if (a.nodeCount > 0) {
                    context.selectedAirportIds.add(a.id);
                }
            });
            saveStoredSelectedAirportIds(context.selectedAirportIds);
        }

        saveStoredAirports(mergedAirports);

        if (typeof context.renderAirports === "function") context.renderAirports();
        if (typeof context.renderAirportSelectors === "function") context.renderAirportSelectors();
        if (typeof context.updateCombinedCurrentNodes === "function") context.updateCombinedCurrentNodes();
        updateSidebarCounters();

        const totalActiveNodes = mergedAirports.reduce((sum, a) => sum + (a.nodeCount || 0), 0);
        showToast(t("backup.toast_import_success", { airports: validatedAirports.length, total: totalImportedNodes, active: totalActiveNodes }, `🎉 Successfully imported ${validatedAirports.length} airports (${totalImportedNodes} total nodes, ${totalActiveNodes} available in workspace)!`));
    };

    if (currentAirports.length > 0) {
        openConfirmModal(
            t("backup.confirm_import_title", {}, "📥 Confirm Airport & Node Import"),
            t("backup.confirm_import_content", { airports: validatedAirports.length, nodes: totalImportedNodes }, `Backup file contains <b>${validatedAirports.length}</b> airports (${totalImportedNodes} nodes).<br><br><b>Smart merge</b> will update nodes and filter rules for matching airports, and append new airports.`),
            doMergeAndSave,
            t("backup.btn_confirm_import", {}, "Import"),
            "btn-primary"
        );
    } else {
        doMergeAndSave();
    }
}
