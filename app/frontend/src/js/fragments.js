/**
 * fragments.js
 * 异步视图与弹窗代码片段加载协调器 (Fragment Loader)。
 * 
 * 核心特性：
 * 将抽屉 (Drawer)、模态对话框 (Modal) 和大型页面视图从单体 index.html 中解耦，
 * 在 DOMContentLoaded 时通过并发 fetch 动态注入到宿主容器 DOM 中。
 */

const MODAL_FRAGMENTS = [
    "./fragments/modal_export.html",
    "./fragments/drawer_node_filter.html",
    "./fragments/drawer_nodes_list.html",
    "./fragments/drawer_runtime_log.html",
    "./fragments/modal_confirm.html",
    "./fragments/modal_error_diag.html"
];

const VIEW_FRAGMENTS = [
    { file: "./fragments/settings_probes.html", targetId: "settings-panel-probes" },
    { file: "./fragments/settings_engine.html", targetId: "settings-panel-engine" }
];

/**
 * 并发加载所有模态窗、抽屉及页面视图 HTML 片段并挂载至容器。
 * @param {string} modalsContainerId - 弹窗挂载的父容器 DOM 元素 ID
 * @returns {Promise<boolean>} 加载挂载是否成功
 */
export async function loadHtmlFragments(modalsContainerId = "app-modals-container") {
    let modalsContainer = document.getElementById(modalsContainerId);
    if (!modalsContainer) {
        modalsContainer = document.createElement("div");
        modalsContainer.id = modalsContainerId;
        document.body.appendChild(modalsContainer);
    }

    try {
        // 1. 并发拉取所有模态框与抽屉片段
        const modalFetchPromises = MODAL_FRAGMENTS.map(async (filePath) => {
            const res = await fetch(filePath);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} when loading fragment: ${filePath}`);
            }
            return res.text();
        });

        // 2. 并发拉取页面级视图片段
        const viewFetchPromises = VIEW_FRAGMENTS.map(async ({ file, targetId }) => {
            const res = await fetch(file);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} when loading view fragment: ${file}`);
            }
            const html = await res.text();
            return { targetId, html };
        });

        // 3. 并发等待所有网络资源加载完成
        const [modalSnippets, viewResults] = await Promise.all([
            Promise.all(modalFetchPromises),
            Promise.all(viewFetchPromises)
        ]);

        // 4. 挂载弹窗与抽屉片段
        modalsContainer.innerHTML = modalSnippets.join("\n");

        // 5. 将页面级视图片段挂载至对应的目标卡槽中
        viewResults.forEach(({ targetId, html }) => {
            const el = document.getElementById(targetId);
            if (el) {
                el.innerHTML = html;
            } else {
                console.warn(`View fragment target #${targetId} not found in DOM`);
            }
        });

        // 全局 ESC 按键监听器：按 ESC 键时关闭顶层活动的弹窗或抽屉
        if (!window._modalEscBound) {
            window._modalEscBound = true;
            window.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                    const activeModals = Array.from(document.querySelectorAll(".modal:not(.hidden), .drawer-overlay.drawer-open:not(.hidden)"));
                    if (activeModals.length > 0) {
                        const topModal = activeModals[activeModals.length - 1];
                        const closeBtn = topModal.querySelector(".btn-close");
                        if (closeBtn) closeBtn.click();
                        else topModal.classList.add("hidden");
                    }
                }
            });
        }

        return true;
    } catch (err) {
        console.error("Failed to load HTML fragments:", err);
        return false;
    }
}
