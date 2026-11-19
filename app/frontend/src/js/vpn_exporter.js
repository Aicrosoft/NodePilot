/**
 * vpn_exporter.js
 * VPN 代理配置生成器与序列化引擎（支持 Clash / Mihomo / Shadowrocket）。
 * 
 * 核心能力：
 * 1. Shadowrocket 单节点 URI 协议链接生成 (Hysteria2, Trojan, Shadowsocks, VMess, VLESS)；
 * 2. Shadowrocket / 通用 Base64 订阅文本生成；
 * 3. Clash / Mihomo 完整代理 YAML 配置文件生成（包含 url-test 自动选优与 PROXY 分组）；
 * 4. 客户端安全文件导出与 Blob 动态下载。
 */

import { showToast } from "./utils.js";
import { t } from "./i18n/i18n.js";

// 当前导出弹窗数据缓存
let exportDataCache = {
    clash: "",
    uri: "",
    base64: "",
    airportName: "NodePilot",
    count: 0
};
let currentExportFmt = "clash";

/**
 * 为给定的节点列表生成 Shadowrocket 单节点协议 URI 链接列表（每行一条）。
 * @param {Array} nodes - 节点对象列表
 * @returns {Array<string>} URI 字符串数组
 */
export function generateShadowrocketURIs(nodes) {
    if (!Array.isArray(nodes)) return [];
    const uris = [];

    nodes.forEach(n => {
        const raw = (n.raw && typeof n.raw === "object") ? n.raw : {};
        const name = encodeURIComponent(n.name || "Node");
        const type = (n.type || "").toLowerCase();

        if (type === "hysteria2" || type === "hy2") {
            const auth = n.password || raw.auth || raw.password || "";
            const sni = raw.sni || n.server;
            const insecure = raw["skip-cert-verify"] ? "1" : "0";
            uris.push(`hysteria2://${auth}@${n.server}:${n.port}/?sni=${sni}&insecure=${insecure}#${name}`);
        } else if (type === "trojan") {
            const password = n.password || raw.password || "";
            const sni = raw.sni || n.server;
            const insecure = raw["skip-cert-verify"] ? "1" : "0";
            uris.push(`trojan://${password}@${n.server}:${n.port}?sni=${sni}&allowInsecure=${insecure}#${name}`);
        } else if (type === "ss" || type === "shadowsocks") {
            const cipher = raw.cipher || "aes-256-gcm";
            const password = n.password || raw.password || "";
            const cred = btoa(`${cipher}:${password}`);
            uris.push(`ss://${cred}@${n.server}:${n.port}#${name}`);
        } else if (type === "vmess") {
            const vObj = {
                v: "2",
                ps: n.name,
                add: n.server,
                port: String(n.port),
                id: n.password || raw.uuid || "",
                aid: "0",
                scy: "auto",
                net: raw.network || "tcp",
                type: "none",
                tls: raw.tls ? "tls" : ""
            };
            try {
                const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(vObj))));
                uris.push(`vmess://${b64}`);
            } catch {
                uris.push(`vmess://${n.server}:${n.port}#${name}`);
            }
        } else if (type === "vless" || type === "anytls") {
            const uuid = n.password || raw.uuid || "";
            const sni = raw.sni || n.server;
            uris.push(`vless://${uuid}@${n.server}:${n.port}?security=${raw.tls ? "tls" : "none"}&sni=${sni}#${name}`);
        } else {
            // 通用 URI 降级方案
            uris.push(`${type}://${n.server}:${n.port}#${name}`);
        }
    });

    return uris;
}

/**
 * 将节点列表序列化为标准 Base64 订阅文本字符串。
 * @param {Array} nodes - 节点对象列表
 * @returns {string} Base64 编码的订阅字符串
 */
export function generateBase64Subscription(nodes) {
    const uris = generateShadowrocketURIs(nodes);
    const text = uris.join("\n");
    if (!text) return "";
    try {
        return btoa(unescape(encodeURIComponent(text)));
    } catch {
        return btoa(text);
    }
}

/**
 * 为优选节点生成开箱即用的完整 Clash / Mihomo 配置文件 (YAML)。
 * @param {Array} nodes - 优选节点列表
 * @param {string} airportName - 订阅/机场名称
 * @returns {string} 完整的 YAML 配置字符串
 */
export function generateClashYAML(nodes, airportName = "NodePilot") {
    if (!Array.isArray(nodes)) return "";

    let y = `# ========================================================\n`;
    y += `# NodePilot AI 优选代理配置 (已按实测指标过滤)\n`;
    y += `# 机场/订阅: ${airportName}\n`;
    y += `# 优选节点数: ${nodes.length}\n`;
    y += `# 导出时间: ${new Date().toLocaleString()}\n`;
    y += `# ========================================================\n\n`;

    y += `port: 7890\n`;
    y += `socks-port: 7891\n`;
    y += `allow-lan: false\n`;
    y += `mode: rule\n`;
    y += `log-level: info\n`;
    y += `external-controller: 127.0.0.1:9090\n\n`;

    y += `proxies:\n`;
    nodes.forEach(n => {
        const raw = (n.raw && typeof n.raw === "object") ? Object.assign({}, n.raw) : {};
        const safeName = (n.name || "").replace(/"/g, '\\"');
        const nodeType = n.type || "hysteria2";

        y += `  - name: "${safeName}"\n`;
        y += `    type: ${nodeType}\n`;
        y += `    server: ${n.server}\n`;
        y += `    port: ${n.port}\n`;

        if (n.password) {
            if (nodeType === "vmess" || nodeType === "vless") {
                y += `    uuid: ${n.password}\n`;
            } else {
                y += `    password: "${n.password}"\n`;
            }
        }

        // 写入自定义扩展字段
        for (const [k, v] of Object.entries(raw)) {
            if (["name", "type", "server", "port", "password", "uuid", "auth"].includes(k)) continue;
            if (v === undefined || v === null) continue;
            if (typeof v === "boolean" || typeof v === "number") {
                y += `    ${k}: ${v}\n`;
            } else if (typeof v === "string") {
                y += `    ${k}: "${v.replace(/"/g, '\\"')}"\n`;
            } else if (Array.isArray(v)) {
                y += `    ${k}: [${v.map(x => JSON.stringify(x)).join(", ")}]\n`;
            }
        }
    });

    y += `\nproxy-groups:\n`;
    y += `  - name: "⚡ 优选节点-自动选优"\n`;
    y += `    type: url-test\n`;
    y += `    url: http://www.gstatic.com/generate_204\n`;
    y += `    interval: 300\n`;
    y += `    tolerance: 50\n`;
    y += `    proxies:\n`;
    nodes.forEach(n => {
        y += `      - "${n.name.replace(/"/g, '\\"')}"\n`;
    });

    y += `\n  - name: "🚀 PROXY"\n`;
    y += `    type: select\n`;
    y += `    proxies:\n`;
    y += `      - "⚡ 优选节点-自动选优"\n`;
    nodes.forEach(n => {
        y += `      - "${n.name.replace(/"/g, '\\"')}"\n`;
    });
    y += `      - DIRECT\n`;

    y += `\nrules:\n`;
    y += `  - DOMAIN-SUFFIX,googleapis.com,PROXY\n`;
    y += `  - DOMAIN-SUFFIX,openai.com,PROXY\n`;
    y += `  - DOMAIN-SUFFIX,anthropic.com,PROXY\n`;
    y += `  - DOMAIN-SUFFIX,cursor.sh,PROXY\n`;
    y += `  - MATCH,PROXY\n`;

    return y;
}

/**
 * 打开节点导出模态弹窗并填充各格式缓存及默认选项卡。
 * @param {Array} nodes - 待导出的节点列表
 * @param {string} airportName - 机场/订阅名称
 */
export function openExportModal(nodes, airportName = "NodePilot") {
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalText = document.getElementById("modal-text");
    const tabsBar = document.getElementById("export-tabs-bar");
    const exportInfo = document.getElementById("modal-export-info");

    const uris = generateShadowrocketURIs(nodes);
    const uriStr = uris.join("\n");
    const base64Str = generateBase64Subscription(nodes);
    const clashYaml = generateClashYAML(nodes, airportName);

    exportDataCache = {
        clash: clashYaml,
        uri: uriStr,
        base64: base64Str,
        airportName: airportName,
        count: nodes.length
    };

    if (modalTitle) modalTitle.innerText = t("export.modal_title_airport", { name: airportName, count: nodes.length }, `📤 Export Nodes - "${airportName}" (${nodes.length} nodes)`);
    if (tabsBar) {
        tabsBar.style.display = "flex";
        tabsBar.classList.remove("hidden");
    }

    currentExportFmt = "clash";
    if (tabsBar) {
        tabsBar.querySelectorAll(".tab-btn").forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-fmt") === "clash");
        });
    }

    if (modalText) modalText.value = clashYaml;
    if (exportInfo) exportInfo.innerText = t("export.info_clash", { count: nodes.length }, `Format: Clash / Mihomo YAML | Nodes: ${nodes.length}`);
    if (modal) modal.classList.remove("hidden");
}

/**
 * 初始化导出弹窗交互事件（格式选项卡切换与文件一键下载）。
 */
export function initExportModalEvents() {
    const tabsBar = document.getElementById("export-tabs-bar");
    const modalText = document.getElementById("modal-text");
    const exportInfo = document.getElementById("modal-export-info");
    const btnDownload = document.getElementById("btn-download-export");

    if (tabsBar) {
        tabsBar.addEventListener("click", (e) => {
            const btn = e.target.closest(".tab-btn");
            if (!btn) return;
            const fmt = btn.getAttribute("data-fmt");
            if (!fmt) return;

            tabsBar.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentExportFmt = fmt;

            if (fmt === "clash") {
                if (modalText) modalText.value = exportDataCache.clash;
                if (exportInfo) exportInfo.innerText = t("export.info_clash", { count: exportDataCache.count || 0 }, `Format: Clash / Mihomo YAML | Nodes: ${exportDataCache.count || 0}`);
            } else if (fmt === "uri") {
                if (modalText) modalText.value = exportDataCache.uri;
                if (exportInfo) exportInfo.innerText = t("export.info_uri", { count: exportDataCache.count || 0 }, `Format: Shadowrocket plain links (one per line) | Nodes: ${exportDataCache.count || 0}`);
            } else if (fmt === "base64") {
                if (modalText) modalText.value = exportDataCache.base64;
                if (exportInfo) exportInfo.innerText = t("export.info_base64", {}, "Format: Base64 subscription string (Shadowrocket / Universal)");
            }
        });
    }

    // 下载为本地配置文件
    if (btnDownload) {
        btnDownload.addEventListener("click", () => {
            const content = modalText ? modalText.value : "";
            if (!content) return;

            const safeAp = (exportDataCache.airportName || "NodePilot").replace(/[^\w\u4e00-\u9fa5_-]/g, "_");
            let filename = `nodepilot_${safeAp}.yaml`;
            let mimeType = "text/yaml;charset=utf-8";

            if (currentExportFmt === "clash") {
                filename = `nodepilot_${safeAp}_clash.yaml`;
                mimeType = "text/yaml;charset=utf-8";
            } else if (currentExportFmt === "uri") {
                filename = `nodepilot_${safeAp}_shadowrocket.txt`;
                mimeType = "text/plain;charset=utf-8";
            } else if (currentExportFmt === "base64") {
                filename = `nodepilot_${safeAp}_subscription.txt`;
                mimeType = "text/plain;charset=utf-8";
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(t("export.toast_downloaded", { name: filename }, `💾 Config file downloaded: ${filename}`));
        });
    }
}
