/**
 * airport_manager.js
 * 机场与订阅管理控制器：负责订阅增删改查 (CRUD)、URL 格式校验、本地 YAML 导入、卡片双行布局渲染、多机场聚合及节点筛选状态流转。
 */

import { escapeHtml, formatNow, formatFullDateTime, showToast, openConfirmModal } from "./utils.js";
import {
    getStoredAirports,
    saveStoredAirports,
    getStoredSelectedAirportIds,
    saveStoredSelectedAirportIds
} from "./store.js";
import {
    validateSubscriptionURL,
    showAirportFormTip,
    hideAirportFormTip,
    openErrorDiagModal
} from "./diag.js";
import { openNodesListModal } from "./nodes_modal.js";
import {
    initNodeFilterModal,
    openNodeFilterModal,
    applyNodeFilters
} from "./node_filter.js";
import { switchView, updateSidebarCounters } from "./sidebar.js";
import {
    exportAllAirports as exportAllAirportsImpl,
    importAllAirports as importAllAirportsImpl,
    executeImportAirports as executeImportAirportsImpl
} from "./airport_backup.js";
import { t, getCurrentLanguage } from "./i18n/i18n.js";

let selectedAirportIds = new Set();
let currentCombinedNodes = [];
let editingAirportId = null;
let onNodesChangedCallback = null;

export function getSelectedAirportIds() {
    return selectedAirportIds;
}

export function setSelectedAirportIds(ids) {
    selectedAirportIds = new Set(ids);
    saveStoredSelectedAirportIds(selectedAirportIds);
    renderAirportSelectors();
    updateCombinedCurrentNodes();
}

/**
 * 根据正则包含与排除规则获取特定机场过滤后的有效代理节点列表。
 * @param {Object} airport - 目标机场数据实体
 * @returns {Array<Object>} 过滤后的有效代理节点列表
 */
export function getFilteredNodesForAirport(airport) {
    if (!airport) return [];
    const raw = (Array.isArray(airport.rawNodes) && airport.rawNodes.length > 0)
        ? airport.rawNodes
        : (Array.isArray(airport.nodes) ? airport.nodes : []);
    return applyNodeFilters(raw, airport.filterRules);
}

/**
 * 获取当前所有已勾选激活机场的合并测试节点集合（附带所属机场上下文属性）。
 * @returns {Array<Object>} 聚合后的测试节点全集
 */
export function getCurrentCombinedNodes() {
    const airports = getStoredAirports();
    const combined = [];
    airports.forEach(airport => {
        if (selectedAirportIds.has(airport.id)) {
            const validFilteredNodes = getFilteredNodesForAirport(airport);
            validFilteredNodes.forEach(node => {
                const clone = Object.assign({}, node);
                clone.airportName = airport.name;
                clone.airportId = airport.id;
                combined.push(clone);
            });
        }
    });
    return combined;
}

/**
 * 初始化机场订阅管理器交互事件与初始状态恢复
 * @param {Function} onNodesChanged - 节点总集变更时的回调通知函数
 */
export function initAirportManager(onNodesChanged) {
    onNodesChangedCallback = onNodesChanged;
    const btnAirportMgr = document.getElementById("btn-airport-mgr");
    const modalAirports = document.getElementById("modal-airports");
    const modalAirportsClose = document.getElementById("modal-airports-close");
    const modalAirportsOk = document.getElementById("modal-airports-ok");

    const airportNameInput = document.getElementById("airport-name-input");
    const airportUrlInput = document.getElementById("airport-url-input");
    const btnSaveAirport = document.getElementById("btn-save-airport");
    const btnImportYAML = document.getElementById("btn-import-yaml");
    const btnCancelEditAirport = document.getElementById("btn-cancel-edit-airport");

    const checkAllAirports = document.getElementById("check-all-airports");

    // 1. 恢复持久化的已选机场状态集合
    const storedSelected = getStoredSelectedAirportIds();
    if (storedSelected && Array.isArray(storedSelected) && storedSelected.length > 0) {
        selectedAirportIds = new Set(storedSelected);
    } else {
        selectedAirportIds = new Set();
    }

    renderAirportSelectors();
    updateCombinedCurrentNodes(onNodesChanged);

    // 下拉面板展开/收起切换与全选交互处理
    const btnDropdownAirports = document.getElementById("btn-dropdown-airports");
    const panelDropdownAirports = document.getElementById("dropdown-airports-panel");
    const dropdownWrapAirports = document.getElementById("dropdown-airports");
    const btnToggleAllAirports = document.getElementById("btn-toggle-all-airports");

    if (btnDropdownAirports && panelDropdownAirports) {
        btnDropdownAirports.addEventListener("click", (e) => {
            e.stopPropagation();
            // 关闭其他已打开的下拉浮层
            document.querySelectorAll(".multi-select-dropdown").forEach(el => {
                if (el !== dropdownWrapAirports) {
                    el.classList.remove("open");
                    el.querySelector(".dropdown-menu-panel")?.classList.add("hidden");
                }
            });

            const isHidden = panelDropdownAirports.classList.contains("hidden");
            if (isHidden) {
                panelDropdownAirports.classList.remove("hidden");
                dropdownWrapAirports?.classList.add("open");
            } else {
                panelDropdownAirports.classList.add("hidden");
                dropdownWrapAirports?.classList.remove("open");
            }
        });

        panelDropdownAirports.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    if (btnToggleAllAirports) {
        btnToggleAllAirports.addEventListener("click", () => {
            const currentAirports = getStoredAirports();
            if (selectedAirportIds.size === currentAirports.length) {
                selectedAirportIds.clear();
            } else {
                currentAirports.forEach(a => selectedAirportIds.add(a.id));
            }
            saveStoredSelectedAirportIds(selectedAirportIds);
            renderAirportSelectors();
            updateCombinedCurrentNodes(onNodesChanged);
        });
    }

    // 初始化节点正则过滤模态框交互
    initNodeFilterModal(() => {
        renderAirports();
        renderAirportSelectors();
        updateCombinedCurrentNodes(onNodesChanged);
    });

    // 2. 模态框打开与关闭监听
    if (btnAirportMgr) {
        btnAirportMgr.addEventListener("click", () => {
            switchView("airports");
        });
    }
    if (modalAirportsClose) modalAirportsClose.addEventListener("click", () => modalAirports.classList.add("hidden"));
    if (modalAirportsOk) modalAirportsOk.addEventListener("click", () => modalAirports.classList.add("hidden"));

    // 3. 动态输入校验与实时提示清除
    if (airportUrlInput) {
        airportUrlInput.addEventListener("input", () => {
            hideAirportFormTip();
        });
    }

    // 4. 新增或更新在线 URL 订阅
    if (btnSaveAirport) {
        btnSaveAirport.addEventListener("click", () => {
            const name = airportNameInput.value.trim();
            const url = airportUrlInput.value.trim();

            const urlError = validateSubscriptionURL(url);
            if (urlError) {
                showAirportFormTip(urlError);
                airportUrlInput.focus();
                return;
            }
            hideAirportFormTip();

            const currentAirports = getStoredAirports();
            if (editingAirportId) {
                const item = currentAirports.find(a => a.id === editingAirportId);
                if (item) {
                    item.name = name || item.name;
                    item.url = url;
                    delete item.lastError;
                    delete item.lastErrorTime;
                    item.status = "unfetched";
                }
                resetAirportForm();
                showToast(t("airports.toast_updated", { name: name || (item && item.name) }, `💾 Successfully updated airport "${name || (item && item.name)}"`));
            } else {
                const finalName = name || t("airports.default_airport_name", { num: currentAirports.length + 1 }, `Airport ${currentAirports.length + 1}`);
                currentAirports.push({
                    id: Date.now().toString(),
                    name: finalName,
                    type: "url",
                    url: url,
                    nodeCount: 0,
                    nodes: [],
                    status: "unfetched",
                    updatedAt: "-"
                });
                resetAirportForm();
                showToast(t("airports.toast_added", { name: finalName }, `➕ Successfully added airport "${finalName}"`));
            }
            saveStoredAirports(currentAirports);
            renderAirports();
            renderAirportSelectors();
        });
    }

    // 5. 导入本地 YAML 格式代理配置文件
    if (btnImportYAML) {
        btnImportYAML.addEventListener("click", async () => {
            try {
                if (!window.go || !window.go.main || !window.go.main.App) return;
                const filePath = await window.go.main.App.SelectConfigFile();
                if (!filePath) return;

                const nodes = await window.go.main.App.ParseNodesFromFile(filePath);
                if (!nodes || nodes.length === 0) {
                    alert(t("airports.alert_yaml_parse_fail", {}, "Failed to parse valid proxy nodes from this YAML file"));
                    return;
                }

                const slashIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
                const rawName = slashIdx !== -1 ? filePath.substring(slashIdx + 1) : filePath;
                const fileName = rawName.replace(/\.[^/.]+$/, "");

                const customName = airportNameInput.value.trim();
                const airportName = customName || t("airports.local_prefix", { name: fileName }, `Local: ${fileName}`);

                const currentAirports = getStoredAirports();
                const filteredNodes = applyNodeFilters(nodes, null);
                const newAirport = {
                    id: Date.now().toString(),
                    name: airportName,
                    type: "file",
                    filePath: filePath,
                    url: filePath,
                    rawNodes: nodes,
                    totalNodeCount: nodes.length,
                    nodeCount: filteredNodes.length,
                    nodes: filteredNodes,
                    filterRules: null,
                    status: "ok",
                    updatedAt: formatNow()
                };

                currentAirports.push(newAirport);
                selectedAirportIds.add(newAirport.id);
                saveStoredAirports(currentAirports);
                saveStoredSelectedAirportIds(selectedAirportIds);

                resetAirportForm();
                renderAirports();
                renderAirportSelectors();
                updateCombinedCurrentNodes(onNodesChanged);
                showToast(t("airports.toast_import_yaml", { name: airportName, count: nodes.length }, `✅ Imported local YAML "${airportName}" with ${nodes.length} nodes!`));
            } catch (err) {
                alert(t("airports.alert_yaml_read_fail", { error: err }, "Failed to read or parse local YAML: " + err));
            }
        });
    }

    if (btnCancelEditAirport) {
        btnCancelEditAirport.addEventListener("click", resetAirportForm);
    }

    // 6. 一键全量备份导出所有机场配置
    const btnExportAllAirports = document.getElementById("btn-export-all-airports");
    if (btnExportAllAirports) {
        btnExportAllAirports.addEventListener("click", () => {
            exportAllAirports();
        });
    }

    // 7. 一键从备份文件导入并恢复所有机场
    const btnImportAllAirports = document.getElementById("btn-import-all-airports");
    if (btnImportAllAirports) {
        btnImportAllAirports.addEventListener("click", () => {
            importAllAirports();
        });
    }

    // 8. 列表表头全选与取消全选切换
    if (checkAllAirports) {
        checkAllAirports.addEventListener("change", (e) => {
            const currentAirports = getStoredAirports();
            if (e.target.checked) {
                selectedAirportIds = new Set(currentAirports.map(a => a.id));
            } else {
                selectedAirportIds.clear();
            }
            saveStoredSelectedAirportIds(selectedAirportIds);
            renderAirportSelectors();
            updateCombinedCurrentNodes(onNodesChanged);
        });
    }
}

/**
 * 重置机场编辑表单至新增初始状态
 */
export function resetAirportForm() {
    editingAirportId = null;
    const airportNameInput = document.getElementById("airport-name-input");
    const airportUrlInput = document.getElementById("airport-url-input");
    const btnSaveAirport = document.getElementById("btn-save-airport");
    const btnCancelEditAirport = document.getElementById("btn-cancel-edit-airport");

    if (airportNameInput) airportNameInput.value = "";
    if (airportUrlInput) airportUrlInput.value = "";
    if (btnSaveAirport) btnSaveAirport.innerText = t("airports.btn_add_sub", {}, "+ Add Subscription");
    if (btnCancelEditAirport) btnCancelEditAirport.classList.add("hidden");
    hideAirportFormTip();
}

/**
 * 进入特定机场的编辑模式，将配置数据回填至表单
 * @param {Object} airport - 待编辑的机场对象
 */
export function startEditAirport(airport) {
    if (!airport) return;
    editingAirportId = airport.id;
    const airportNameInput = document.getElementById("airport-name-input");
    const airportUrlInput = document.getElementById("airport-url-input");
    const btnSaveAirport = document.getElementById("btn-save-airport");
    const btnCancelEditAirport = document.getElementById("btn-cancel-edit-airport");

    if (airportNameInput) airportNameInput.value = airport.name;
    if (airportUrlInput) airportUrlInput.value = airport.url;
    if (btnSaveAirport) btnSaveAirport.innerText = t("airports.btn_save_changes", {}, "💾 Save Changes");
    if (btnCancelEditAirport) btnCancelEditAirport.classList.remove("hidden");

    if (airport.lastError) {
        showAirportFormTip(t("airports.last_error_prefix", { error: airport.lastError }, `⚠️ Last fetch error: ${airport.lastError}`));
    } else {
        hideAirportFormTip();
    }
    if (airportUrlInput) airportUrlInput.focus();
}

/**
 * 渲染订阅管理界面的机场卡片双行列表
 */
export function renderAirports() {
    const airportListContainer = document.getElementById("airport-list-container");
    if (!airportListContainer) return;

    airportListContainer.innerHTML = "";
    const airports = getStoredAirports();

    if (airports.length === 0) {
        airportListContainer.innerHTML = `<div style="text-align:center; color: var(--text-muted); padding: 36px 20px;">${t("airports.empty_list_hint", {}, "No saved airports. Enter a subscription URL or import a local YAML above")}</div>`;
        return;
    }

    airports.forEach(airport => {
        const item = document.createElement("div");
        item.className = "airport-card-item";

        const lang = getCurrentLanguage();
        const isSelected = selectedAirportIds.has(airport.id);
        const activeBadge = isSelected
            ? `<span class="active-airport-badge">${t("airports.badge_selected", {}, "Selected")}</span>`
            : `<span style="font-size:0.7rem; color:var(--text-muted); margin-left:4px;">${t("airports.badge_unselected", {}, "Unselected")}</span>`;

        const hasNodes = (airport.nodeCount > 0 && Array.isArray(airport.nodes) && airport.nodes.length > 0);
        const isFile = (airport.type === "file");

        let actionLabel = hasNodes ? t("airports.refresh_nodes", {}, "🔄 Refresh") : t("airports.load_nodes", {}, "🚀 Load Nodes");
        if (isFile) {
            actionLabel = t("airports.reimport", {}, "📂 Re-import");
        }
        const actionClass = hasNodes ? "btn-secondary" : "btn-primary";

        let typeBadge = `<span class="source-tag url">${t("airports.type_url", {}, "URL Sub")}</span>`;
        if (isFile) {
            typeBadge = `<span class="source-tag file">${t("airports.type_file", {}, "Local YAML")}</span>`;
        }

        // 节点正则过滤配置状态徽章与按钮
        const rules = airport.filterRules || {};
        const hasFilter = !!(rules.include || rules.exclude);
        const totalCount = airport.totalNodeCount || airport.rawNodes?.length || airport.nodeCount || 0;
        const activeCount = airport.nodeCount || 0;

        let filterBadgeHtml = "";
        if (hasNodes || totalCount > 0) {
            if (hasFilter) {
                const incTip = rules.include ? `/${rules.include}/` : t("airports.include_all", {}, "Include: All");
                const excTip = rules.exclude ? `/${rules.exclude}/` : t("airports.exclude_none", {}, "Exclude: None");
                filterBadgeHtml = `
                    <button class="btn-node-filter active" data-id="${airport.id}" title="${t("airports.filter_btn_active_title", { inc: incTip, exc: excTip, active: activeCount, total: totalCount }, `Regex filter active [${incTip} | ${excTip}], keeping ${activeCount}/${totalCount} nodes, click to modify`)}">
                        🎯 ${t("airports.filter_btn_filtered", {}, "Filtered")} (${activeCount}/${totalCount})
                    </button>
                `;
            } else {
                filterBadgeHtml = `
                    <button class="btn-node-filter" data-id="${airport.id}" title="${t("airports.filter_btn_title", {}, "Click to configure include/exclude regex filter rules")}">
                        🔍 ${t("airports.filter_btn_text", {}, "Filter Rules")}
                    </button>
                `;
            }
        }

        let nodeCellHtml = `<span style="color:var(--text-muted); font-size: 0.8rem;">${t("airports.node_unfetched", {}, "No Nodes")}</span>`;
        if (hasNodes && !airport.lastError) {
            const nodeDisplayCount = hasFilter ? `${airport.nodeCount}/${totalCount}` : `${airport.nodeCount}`;
            nodeCellHtml = `<button class="node-count-btn btn-list-nodes" data-id="${airport.id}" title="${t("airports.node_count_btn_title", {}, "Click to view nodes list and benchmark metrics")}">${nodeDisplayCount} ${t("airports.node_count_suffix", {}, "Nodes")} 🔍</button>`;
        } else if (hasNodes && airport.lastError) {
            nodeCellHtml = `
                <div style="display:inline-flex; align-items:center; gap: 6px;">
                    <button class="node-count-btn btn-list-nodes" data-id="${airport.id}" title="${t("airports.node_cached_btn_title", { count: airport.nodeCount }, `View ${airport.nodeCount} cached nodes`)}">${airport.nodeCount} ${t("airports.node_count_short", {}, "Nodes")} 🔍</button>
                    <button class="node-count-btn node-status-error btn-view-diag" data-id="${airport.id}" title="${t("airports.nodes_error_btn_title", {}, "Recent refresh error, click for diagnostics")}">⚠️ ${t("airports.badge_error", {}, "Error")}</button>
                </div>
            `;
        } else if (airport.lastError) {
            nodeCellHtml = `<button class="node-count-btn node-status-error btn-view-diag" data-id="${airport.id}" title="${t("airports.sub_error_btn_title", {}, "Click to view subscription diagnostic analysis")}">⚠️ ${t("airports.badge_sub_error", {}, "Sub Error ❓")}</button>`;
        }

        const displayUrl = airport.filePath || airport.url || "(No URL)";
        const linkIcon = isFile ? "📂" : "🔗";

        item.innerHTML = `
            <!-- 第一行：机场名称 + 状态徽章 + 操作功能区 -->
            <div class="airport-card-top">
                <div class="airport-card-title-group">
                    <span class="airport-card-name">${escapeHtml(airport.name)}</span>
                    ${activeBadge}
                    ${typeBadge}
                </div>
                <div class="airport-card-actions-group">
                    ${filterBadgeHtml}
                    ${nodeCellHtml}
                    <button class="btn ${actionClass} btn-xs btn-load-airport" data-id="${airport.id}">${actionLabel}</button>
                    <button class="btn btn-secondary btn-xs btn-edit-airport" data-id="${airport.id}" title="${t("airports.btn_edit_title", {}, "Edit name or URL")}">✏️</button>
                    <button class="btn btn-danger btn-xs btn-del-airport" data-id="${airport.id}" title="${t("airports.btn_del_title", {}, "Delete")}">🗑️</button>
                </div>
            </div>

            <!-- 第二行：订阅地址/本地路径 + 更新时间 -->
            <div class="airport-card-bottom">
                <div class="airport-card-url-box">
                    <span style="font-size: 0.85rem;">${linkIcon}</span>
                    <span class="airport-card-url" title="${escapeHtml(displayUrl)}">${escapeHtml(displayUrl)}</span>
                    <button class="btn-icon-copy btn-copy-url" data-url="${escapeHtml(displayUrl)}" title="${t("airports.copy_url_title", {}, "Copy address to clipboard")}">📋</button>
                </div>
                <div class="airport-card-time">
                    🕒 ${t("airports.updated_at", {}, "Updated:")} ${airport.updatedAt || "-"}
                </div>
            </div>
        `;

        airportListContainer.appendChild(item);
    });

    // 复制订阅地址至剪贴板
    airportListContainer.querySelectorAll(".btn-copy-url").forEach(btn => {
        btn.addEventListener("click", () => {
            const url = btn.getAttribute("data-url");
            if (url) {
                navigator.clipboard.writeText(url);
                showToast(t("airports.toast_url_copied", {}, "📋 Address copied to clipboard!"));
            }
        });
    });

    // 加载或刷新节点操作响应
    airportListContainer.querySelectorAll(".btn-load-airport").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (!airport) return;

            const isFile = (airport.type === "file");
            const hasNodes = (airport.nodeCount > 0 && Array.isArray(airport.nodes) && airport.nodes.length > 0);
            const currentLabel = isFile ? t("airports.reimport", {}, "📂 Re-import") : (hasNodes ? t("airports.refresh_nodes", {}, "🔄 Refresh") : t("airports.load_nodes", {}, "🚀 Load Nodes"));

            btn.disabled = true;
            btn.innerText = t("airports.processing", {}, "⏳ Processing...");

            try {
                let nodes = [];
                if (isFile) {
                    nodes = await window.go.main.App.ParseNodesFromFile(airport.filePath || airport.url);
                } else {
                    nodes = await window.go.main.App.ParseNodesFromURL(airport.url);
                }

                if (!nodes || nodes.length === 0) {
                    const errStr = t("airports.err_no_nodes_parsed", {}, "Failed to parse valid proxy nodes from this subscription (0 nodes)");
                    airport.status = "error";
                    airport.lastError = errStr;
                    airport.lastErrorTime = formatNow();
                    saveStoredAirports(currentAirports);
                    renderAirports();
                    renderAirportSelectors();
                    updateCombinedCurrentNodes();
                    btn.disabled = false;
                    btn.innerText = currentLabel;
                    openErrorDiagModal(airport, errStr);
                    return;
                }

                delete airport.lastError;
                delete airport.lastErrorTime;
                airport.status = "ok";
                airport.rawNodes = nodes;
                airport.totalNodeCount = nodes.length;
                airport.nodes = applyNodeFilters(nodes, airport.filterRules);
                airport.nodeCount = airport.nodes.length;
                airport.updatedAt = formatNow();
                selectedAirportIds.add(airport.id);

                saveStoredAirports(currentAirports);
                saveStoredSelectedAirportIds(selectedAirportIds);

                renderAirports();
                renderAirportSelectors();
                updateCombinedCurrentNodes();
                const filterNote = (airport.nodeCount !== nodes.length) ? t("airports.filter_note", { kept: airport.nodeCount, total: nodes.length }, ` (Kept ${airport.nodeCount}/${nodes.length} after filtering)`) : "";
                showToast(t("airports.toast_loaded_nodes", { name: airport.name, action: hasNodes ? t("airports.action_refresh", {}, "refresh") : t("airports.action_load", {}, "load"), count: nodes.length, note: filterNote }, `✅ Successfully ${hasNodes ? "refreshed" : "loaded"} ${nodes.length} nodes for "${airport.name}"${filterNote}!`));
            } catch (err) {
                const errStr = String(err);
                airport.status = "error";
                airport.lastError = errStr;
                airport.lastErrorTime = formatNow();
                saveStoredAirports(currentAirports);
                renderAirports();
                renderAirportSelectors();
                updateCombinedCurrentNodes();
                btn.disabled = false;
                btn.innerText = currentLabel;
                openErrorDiagModal(airport, errStr);
            }
        });
    });

    // 错误诊断模态框触发
    airportListContainer.querySelectorAll(".btn-view-diag").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (airport) {
                openErrorDiagModal(airport, airport.lastError);
            }
        });
    });

    // 节点详情列表模态框查看
    airportListContainer.querySelectorAll(".btn-list-nodes").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (airport && airport.nodes && airport.nodes.length > 0) {
                openNodesListModal(airport.nodes, t("airports.nodes_list_title", { name: airport.name }, `📋 Airport "${airport.name}" Nodes List`), airport);
            } else {
                alert(t("airports.alert_no_nodes_yet", {}, "No nodes fetched yet for this airport, please click \"Load Nodes\" first"));
            }
        });
    });

    // 节点正则过滤规则设置模态框打开
    airportListContainer.querySelectorAll(".btn-node-filter").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (airport) {
                if (!Array.isArray(airport.rawNodes) || airport.rawNodes.length === 0) {
                    airport.rawNodes = Array.isArray(airport.nodes) ? airport.nodes.slice() : [];
                    airport.totalNodeCount = airport.rawNodes.length;
                }
                openNodeFilterModal(airport);
            }
        });
    });

    // 编辑机场配置
    airportListContainer.querySelectorAll(".btn-edit-airport").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (airport) {
                startEditAirport(airport);
            }
        });
    });

    // 删除机场配置及缓存节点二次确认
    airportListContainer.querySelectorAll(".btn-del-airport").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const currentAirports = getStoredAirports();
            const airport = currentAirports.find(a => a.id === id);
            if (!airport) return;

            const confirmTitle = t("airports.confirm_delete_title", {}, "⚠️ Delete Airport Confirmation");
            const confirmMsg = airport.nodeCount > 0
                ? t("airports.confirm_delete_content_with_nodes", { name: airport.name, count: airport.nodeCount }, `Are you sure you want to delete airport "${airport.name}" (including ${airport.nodeCount} saved nodes)? Its configuration and cached nodes will be permanently removed.`)
                : t("airports.confirm_delete_content", { name: airport.name }, `Are you sure you want to delete airport "${airport.name}"? Its configuration and cached nodes will be permanently removed.`);

            openConfirmModal(
                confirmTitle,
                confirmMsg,
                () => {
                    const updated = currentAirports.filter(a => a.id !== id);
                    selectedAirportIds.delete(id);
                    saveStoredAirports(updated);
                    saveStoredSelectedAirportIds(selectedAirportIds);
                    renderAirports();
                    renderAirportSelectors();
                    updateCombinedCurrentNodes();
                    showToast(t("airports.toast_deleted", { name: airport.name }, `🗑️ Successfully deleted airport "${airport.name}"`));
                }
            );
        });
    });
}

/**
 * 渲染顶部工具栏中的多选机场下拉选项列表
 */
export function renderAirportSelectors() {
    const listContainer = document.getElementById("dropdown-airports-list");
    const toggleAllBtn = document.getElementById("btn-toggle-all-airports");

    if (!listContainer) return;
    listContainer.innerHTML = "";

    const airports = getStoredAirports();

    if (airports.length === 0) {
        listContainer.innerHTML = `<span class="tip-text" style="color: var(--text-muted); padding: 10px 12px; display: block;">${t("airports.no_airports_hint", {}, "No airports configured. Go to \"✈️ Subscriptions\" to add")}</span>`;
        if (toggleAllBtn) toggleAllBtn.style.display = "none";
        updateAirportDropdownTriggerText();
        return;
    }

    if (toggleAllBtn) toggleAllBtn.style.display = "block";

    airports.forEach(airport => {
        const isChecked = selectedAirportIds.has(airport.id);
        const countDesc = airport.nodeCount > 0 ? `${airport.nodeCount}` : "0";
        let errorBadge = "";
        if (airport.lastError) {
            errorBadge = `<span class="airport-error-badge" style="margin-left: 4px;" title="${t("airports.badge_error", {}, "⚠️ Error")}: ${escapeHtml(airport.lastError)}">${t("airports.badge_error", {}, "⚠️ Error")}</span>`;
        }
        const label = document.createElement("label");
        label.className = "dropdown-item-label";
        label.innerHTML = `
            <input type="checkbox" name="airport-group" value="${airport.id}" ${isChecked ? "checked" : ""}>
            <span class="dropdown-item-name">${escapeHtml(airport.name)}</span>
            <span style="color: var(--accent-secondary); font-size: 0.75rem;">(${countDesc})</span>${errorBadge}
        `;
        listContainer.appendChild(label);
    });

    const airportBoxes = listContainer.querySelectorAll('input[name="airport-group"]');
    airportBoxes.forEach(cb => {
        cb.addEventListener("change", (e) => {
            const id = e.target.value;
            if (e.target.checked) {
                selectedAirportIds.add(id);
            } else {
                selectedAirportIds.delete(id);
            }
            saveStoredSelectedAirportIds(selectedAirportIds);
            updateAirportDropdownTriggerText();
            updateCombinedCurrentNodes();
        });
    });

    updateAirportDropdownTriggerText();
}

/**
 * 刷新顶部工具栏机场选择下拉按钮的显示文本
 */
export function updateAirportDropdownTriggerText() {
    const triggerText = document.getElementById("dropdown-airports-text");
    if (!triggerText) return;
    const airports = getStoredAirports();
    if (airports.length === 0) {
        triggerText.innerText = t("toolbar.airports_none", {}, "Airports: None");
        return;
    }
    const count = selectedAirportIds.size;
    if (count === 0) {
        triggerText.innerText = t("toolbar.airports_unselected", {}, "Airports: None (0)");
    } else if (count === airports.length) {
        triggerText.innerText = t("toolbar.airports_all", { count }, `Airports: All (${count})`);
    } else {
        triggerText.innerText = t("toolbar.airports_count", { selected: count, total: airports.length }, `Airports: ${count}/${airports.length}`);
    }
}

/**
 * 同步机场选择全选复选框的状态与文案
 */
export function syncCheckAllAirportsState() {
    updateAirportDropdownTriggerText();
}

/**
 * 清空当前已选中的所有机场
 * @param {Function} [callback] - 选区清空完成后的变更通知回调函数
 */
export function clearAirportSelection(callback) {
    selectedAirportIds.clear();
    saveStoredSelectedAirportIds(selectedAirportIds);
    renderAirportSelectors();
    updateCombinedCurrentNodes(callback);
}

/**
 * 汇总计算当前已勾选机场的合并节点集，并同步更新节点计数徽章与侧边栏计数器
 * @param {Function} [callback] - 节点集计算完成后的回调通知函数
 */
export function updateCombinedCurrentNodes(callback) {
    const nodeCountBadge = document.getElementById("node-count-badge");
    const airports = getStoredAirports();

    currentCombinedNodes = getCurrentCombinedNodes();

    let selectedAirportCount = 0;
    airports.forEach(airport => {
        if (selectedAirportIds.has(airport.id)) {
            selectedAirportCount++;
        }
    });

    if (nodeCountBadge) {
        nodeCountBadge.innerText = t("airports.total_nodes_badge", { nodes: currentCombinedNodes.length, airports: selectedAirportCount }, `Nodes: ${currentCombinedNodes.length} 🔍 (${selectedAirportCount} Airport(s))`);
        if (currentCombinedNodes.length > 0) {
            nodeCountBadge.style.color = "#10b981";
        } else {
            nodeCountBadge.style.color = "#ef4444";
        }
    }

    updateSidebarCounters(selectedAirportCount, currentCombinedNodes.length);

    const cb = (typeof callback === "function") ? callback : onNodesChangedCallback;
    if (typeof cb === "function") {
        cb(currentCombinedNodes);
    }
}

/**
 * 获取机场备份与恢复执行所需的上下文操作环境
 * @returns {Object} 备份恢复上下文对象
 */
function getBackupContext() {
    return {
        selectedAirportIds,
        renderAirports,
        renderAirportSelectors,
        updateCombinedCurrentNodes: () => updateCombinedCurrentNodes(onNodesChangedCallback)
    };
}

/**
 * 一键导出全量机场配置及其缓存节点数据（JSON 备份）
 * @returns {Promise<boolean>}
 */
export async function exportAllAirports() {
    return exportAllAirportsImpl();
}

/**
 * 调起文件选择器从 JSON 备份文件导入并恢复所有机场配置
 * @returns {Promise<boolean>}
 */
export async function importAllAirports() {
    return importAllAirportsImpl(getBackupContext());
}

/**
 * 解析并合并导入的机场备份 JSON 字符串数据
 * @param {string} jsonContent - 待解析的 JSON 字符串
 * @returns {{ success: boolean, message: string }} 导入结果报告
 */
export function executeImportAirports(jsonContent) {
    return executeImportAirportsImpl(jsonContent, getBackupContext());
}
