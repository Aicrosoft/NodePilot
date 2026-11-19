/**
 * main.js
 * NodePilot 前端应用顶层编排器与生命周期协同入口。
 */

import { initTheme } from "./theme.js";
import { initI18n, onLanguageChange, t, setAppVersion } from "./i18n/i18n.js";
import { initConfirmModal } from "./utils.js";
import { initErrorDiagModal } from "./diag.js";
import { initNodesModal, openNodesListModal } from "./nodes_modal.js";
import { loadHtmlFragments } from "./fragments.js";
import { injectMetricTooltips } from "./metric_tooltips.js";
import { initRuntimeLogDrawer } from "./runtime_log.js";
import {
    initAirportManager,
    getCurrentCombinedNodes,
    setSelectedAirportIds,
    startEditAirport,
    renderAirports,
    updateAirportDropdownTriggerText
} from "./airport_manager.js";
import { initBenchmark, renderTable, updateServicesDropdownTriggerText } from "./benchmark.js";
import { initSidebar, switchView, updateSidebarCounters, renderHistoryView } from "./sidebar.js";
import { initSQLiteStorage } from "./store.js";

window.addEventListener("DOMContentLoaded", async () => {
    // 0. 并行异步拉取侧边抽屉与模态框视图片段（HTML 片段解耦加载）
    await loadHtmlFragments();

    // 0.0 完整初始化底层 SQLite 数据库持久化存储引擎（自动完成历史数据与配置迁移）
    await initSQLiteStorage();

    // 0.1 初始化 AIDF 运行态诊断日志抽屉组件
    initRuntimeLogDrawer();

    // 0.1 动态注入各指标专业技术提示气泡（Tooltips）
    injectMetricTooltips();

    // 0.2 初始化浅色/深色/跟随系统主题管理系统
    initTheme();

    // 0.3 初始化多语言国际化系统（中文 / 英文）
    initI18n();
    if (window.go?.main?.App?.GetAppVersion) {
        try {
            const authoritativeVersion = await window.go.main.App.GetAppVersion();
            if (authoritativeVersion) {
                setAppVersion(authoritativeVersion);
            }
        } catch (e) {
            console.warn("Failed to retrieve authoritative version from App backend:", e);
        }
    }
    onLanguageChange(() => {
        updateSidebarCounters();
        renderAirports();
        updateAirportDropdownTriggerText();
        updateServicesDropdownTriggerText();
        renderTable(getCurrentCombinedNodes());
        renderHistoryView();
    });

    // 1. 初始化全局通用二次确认模态对话框
    initConfirmModal();

    // 2. 初始化订阅解析错误深度诊断模态框（注入编辑配置与原地重试回调）
    initErrorDiagModal(
        // onEdit 回调：切换至订阅管理视图并定位至表单编辑状态
        (airport) => {
            switchView("airports");
            startEditAirport(airport);
        },
        // onRetry 回调：原地触发该订阅的加载或刷新操作
        (airportId) => {
            const airportListContainer = document.getElementById("airport-list-container");
            if (airportListContainer) {
                const btn = airportListContainer.querySelector(`.btn-load-airport[data-id="${airportId}"]`);
                if (btn) btn.click();
            }
        }
    );

    // 3. 初始化节点详情列表抽屉/模态框（注入“设为当前生效测试节点”联动回调）
    initNodesModal((appliedAirport, nodes) => {
        if (appliedAirport) {
            setSelectedAirportIds([appliedAirport.id]);
        }
        updateSidebarCounters();
    });

    // 4. 初始化侧边栏导航控制器与视图路由
    initSidebar(() => {
        renderAirports();
    });

    // 5. 初始化机场订阅管理器并建立多选联动
    initAirportManager((combinedNodes) => {
        // 当选区或节点发生变更时，自动刷新评测主表并同步侧边栏计数器
        renderTable(combinedNodes);
        updateSidebarCounters();
    });

    // 6. 初始化多维基准测试引擎与核心排行榜视图
    initBenchmark(() => {
        return getCurrentCombinedNodes();
    });

    // 7. 绑定测试节点总数统计徽章：点击在模态框中查看当前已选全部节点
    const nodeCountBadge = document.getElementById("node-count-badge");
    if (nodeCountBadge) {
        nodeCountBadge.addEventListener("click", () => {
            const currentNodes = getCurrentCombinedNodes();
            openNodesListModal(currentNodes, t("nodes_modal.title_current_selected", {}, "📋 All Nodes in Selected Airports"), null);
        });
    }

    // 首次初始化侧边栏计数状态同步
    updateSidebarCounters();

    // 支持根据持久化偏好自动切入指定视图 (benchmark, airports, history, settings)
    const initialView = localStorage.getItem("nodepilot_initial_view");
    if (initialView && initialView !== "benchmark") {
        switchView(initialView);
    }
});
