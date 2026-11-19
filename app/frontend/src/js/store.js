/**
 * store.js
 * 状态持久化存储管理层（多版本 LocalStorage 容错、机场配置、选中状态以及测速指标持久化）。
 */

import { formatNow, formatFullDateTime, extractMetrics } from "./utils.js";

export const STORAGE_KEYS = ["nodepilot_airports_v2", "nodepilot_airports_v1", "nodepilot_airports"];
export const STORAGE_KEY_SELECTED_AIRPORTS = "nodepilot_selected_airport_ids_v1";
export const STORAGE_KEY_BENCHMARK_RESULTS = "nodepilot_benchmarks_v1";
export const STORAGE_KEY_BENCHMARK_HISTORY = "nodepilot_benchmark_history_records_v1";

let cachedAirportsList = null;
let cachedBenchmarkResults = null;
let cachedSelectedAirportIds = null;

/**
 * 读取本地持久化保存的机场列表（支持多版本历史 Key 向下兼容与容错回退）。
 * @returns {Array} 机场对象数组
 */
export function getStoredAirports() {
    if (cachedAirportsList !== null) {
        return cachedAirportsList;
    }
    for (const key of STORAGE_KEYS) {
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    cachedAirportsList = parsed;
                    return parsed;
                }
            }
        } catch (e) {
            // continue fallback
        }
    }
    cachedAirportsList = [];
    return [];
}

/**
 * 持久化保存机场列表至 localStorage 及 SQLite 数据库。
 * @param {Array} airports - 机场对象列表
 */
export function saveStoredAirports(airports) {
    cachedAirportsList = airports || [];
    try {
        const json = JSON.stringify(airports || []);
        for (const key of STORAGE_KEYS) {
            localStorage.setItem(key, json);
        }
    } catch (e) {
        console.error("Failed to save airport data to localStorage:", e);
    }

    // 同步持久化写入 SQLite 数据库
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAirportsJSON) {
        window.go.main.App.SaveAirportsJSON(JSON.stringify(airports || [])).catch(err => {
            console.error("Failed to save airports to SQLite:", err);
        });
    }
}

/**
 * 获取当前工作区选中的机场 ID 列表。
 * @returns {Array|null} 选中的机场 ID 数组或 null
 */
export function getStoredSelectedAirportIds() {
    if (cachedSelectedAirportIds !== null) {
        return cachedSelectedAirportIds;
    }
    try {
        const data = localStorage.getItem(STORAGE_KEY_SELECTED_AIRPORTS);
        cachedSelectedAirportIds = data ? JSON.parse(data) : null;
        return cachedSelectedAirportIds;
    } catch (e) {
        return null;
    }
}

/**
 * 持久化保存选中的机场 ID 集合至 localStorage 与 SQLite 数据库。
 * @param {Set|Array} selectedIdsSet - 选中的机场 ID 集合
 */
export function saveStoredSelectedAirportIds(selectedIdsSet) {
    const list = Array.from(selectedIdsSet || []);
    cachedSelectedAirportIds = list;
    try {
        localStorage.setItem(STORAGE_KEY_SELECTED_AIRPORTS, JSON.stringify(list));
    } catch (e) {
        console.error("Failed to save selected airport IDs:", e);
    }

    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveAppSetting) {
        window.go.main.App.SaveAppSetting(STORAGE_KEY_SELECTED_AIRPORTS, JSON.stringify(list)).catch(err => {});
    }
}

/**
 * 读取本地持久化存储的最新一次测速快照结果。
 * @returns {Array} 测速结果对象数组
 */
export function getStoredBenchmarkResults() {
    if (cachedBenchmarkResults !== null) {
        return cachedBenchmarkResults;
    }
    try {
        const data = localStorage.getItem(STORAGE_KEY_BENCHMARK_RESULTS);
        cachedBenchmarkResults = data ? JSON.parse(data) : [];
        return cachedBenchmarkResults;
    } catch (e) {
        return [];
    }
}

/**
 * 持久化保存测速快照结果（跨机场、节点、AI 服务、测试指标及时间戳）。
 * @param {Array} results - 最新测速结果数组
 * @param {Array} currentNodes - 当前工作区待测节点集合
 */
export function saveStoredBenchmarkResults(results, currentNodes = []) {
    if (!Array.isArray(results)) return;

    const nodeAirportMap = new Map();
    const nodeDetailsMap = new Map();
    if (Array.isArray(currentNodes)) {
        currentNodes.forEach(n => {
            if (n && n.name) {
                const apName = n.airport_name || n.airportName || "";
                if (apName) nodeAirportMap.set(n.name, apName);
                nodeDetailsMap.set(n.name, n);
            }
        });
    }

    const normalizedList = results.map(r => {
        const m = extractMetrics(r);
        const nodeInfo = nodeDetailsMap.get(m.node_name) || {};
        const airportName = m.airport_name || r.airport_name || nodeAirportMap.get(m.node_name) || nodeInfo.airportName || nodeInfo.airport_name || "";

        return {
            airport_name: airportName,
            node_name: m.node_name,
            node_type: nodeInfo.type || r.node_type || "",
            server: nodeInfo.server || r.server || "",
            port: nodeInfo.port || r.port || 0,
            ai_offer: m.ai_offer,
            service_name: m.service_name,
            // 完整测速指标字段
            status: m.status,
            ping_ms: m.ping_ms || 0,
            ping_status: m.ping_status || "",
            score: m.score,
            ttfb_ms: m.ttfb_ms,
            ttft_ms: m.ttft_ms,
            tps: m.tps,
            jitter_ms: m.jitter_ms,
            bandwidth_bps: m.ingress_bps,
            ingress_mbps: m.ingress_bps > 0 ? parseFloat((m.ingress_bps / (1024 * 1024)).toFixed(2)) : 0,
            proxy_buffer_detected: m.proxy_buffer_detected,
            rank: r.rank || 0,
            // 对齐后的时间戳与批次 ID
            tested_at: m.tested_at,
            tested_time_display: m.tested_time_display,
            batch_time: r.batch_time || m.tested_at,
            // 底层网络握手与流式传输原始数据结构
            network: r.network || null,
            stream: r.stream || null
        };
    });

    const existing = getStoredBenchmarkResults();
    const map = new Map();
    if (Array.isArray(existing)) {
        existing.forEach(item => {
            const key = `${item.airport_name || ""}:::${item.node_name}:::${item.service_name || item.ai_offer || ""}`;
            map.set(key, item);
        });
    }

    normalizedList.forEach(item => {
        const key = `${item.airport_name || ""}:::${item.node_name}:::${item.service_name || item.ai_offer || ""}`;
        map.set(key, item);
    });

    const mergedList = Array.from(map.values());
    cachedBenchmarkResults = mergedList;

    try {
        localStorage.setItem(STORAGE_KEY_BENCHMARK_RESULTS, JSON.stringify(mergedList));
    } catch (e) {
        console.error("Failed to save benchmark results to localStorage:", e);
    }

    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveLatestBenchmarkResultsJSON) {
        window.go.main.App.SaveLatestBenchmarkResultsJSON(JSON.stringify(mergedList)).catch(err => {
            console.error("Failed to save latest benchmark snapshot to SQLite:", err);
        });
    }

    // 追加至历史时序归档数据记录中
    appendStoredBenchmarkHistory(normalizedList);
}

// 内存时序数据运行时缓存
let cachedHistoryList = [];

/**
 * 从 SQLite 数据库异步检索历史测速归档记录。
 * @param {number} limit - 最大检索记录条数
 * @returns {Promise<Array>} 历史测速记录列表
 */
export async function getStoredBenchmarkHistoryAsync(limit = 10000) {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetHistoryRecords) {
        try {
            const records = await window.go.main.App.GetHistoryRecords(limit);
            if (Array.isArray(records) && records.length > 0) {
                cachedHistoryList = records;
                return records;
            }

            // 历史数据平滑无缝迁移：若 SQLite 为空但 localStorage 存在旧版历史，执行自动化单向导入
            const legacy = localStorage.getItem(STORAGE_KEY_BENCHMARK_HISTORY);
            if (legacy) {
                try {
                    const parsed = JSON.parse(legacy);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        await appendStoredBenchmarkHistory(parsed);
                        localStorage.removeItem(STORAGE_KEY_BENCHMARK_HISTORY);
                        const migrated = await window.go.main.App.GetHistoryRecords(limit);
                        if (Array.isArray(migrated) && migrated.length > 0) {
                            cachedHistoryList = migrated;
                            return migrated;
                        }
                    }
                } catch (err) {}
            }
        } catch (e) {
            console.error("Failed to read benchmark history from SQLite:", e);
        }
    }

    return getStoredBenchmarkHistory();
}

/**
 * 异步清空 SQLite 历史测速归档及本地前端缓存。
 */
export async function clearStoredBenchmarkHistoryAsync() {
    cachedHistoryList = [];
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.ClearHistoryRecords) {
        try {
            await window.go.main.App.ClearHistoryRecords();
        } catch (e) {
            console.error("Failed to clear SQLite benchmark history:", e);
        }
    }
    localStorage.removeItem(STORAGE_KEY_BENCHMARK_HISTORY);
    localStorage.removeItem(STORAGE_KEY_BENCHMARK_RESULTS);
}

/**
 * 获取持久化的测速历史归档记录（同步降级接口）。
 * @returns {Array} 历史测速记录数组
 */
export function getStoredBenchmarkHistory() {
    if (cachedHistoryList.length > 0) {
        return cachedHistoryList;
    }
    try {
        const data = localStorage.getItem(STORAGE_KEY_BENCHMARK_HISTORY);
        if (data) {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed) && parsed.length > 0) {
                cachedHistoryList = parsed;
                return parsed;
            }
        }
    } catch (e) {
        // fallback
    }
    const fallback = getStoredBenchmarkResults();
    return Array.isArray(fallback) ? fallback : [];
}

/**
 * 批量追加测速记录至历史归档（优先使用 SQLite 批量事务入库）。
 * @param {Array} records - 待追加的历史测速记录数组
 */
export async function appendStoredBenchmarkHistory(records) {
    if (!Array.isArray(records) || records.length === 0) return;

    cachedHistoryList.push(...records);

    // 调用原生 SQLite 后端服务接口
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveHistoryRecords) {
        try {
            const dbRecords = records.map(r => ({
                batch_id: r.batch_id || r.batch_time || r.tested_at || "",
                airport_name: r.airport_name || "default",
                node_name: r.node_name || "",
                node_type: r.node_type || "",
                server: r.server || "",
                port: parseInt(r.port || 0, 10),
                service_name: r.service_name || r.ai_offer || "",
                ai_offer: r.ai_offer || r.service_name || "",
                status: r.status || "Unavailable",
                ping_ms: parseInt(r.ping_ms || 0, 10),
                ping_status: r.ping_status || "",
                score: parseFloat((r.score || 0).toFixed(2)),
                ttfb_ms: parseFloat((r.ttfb_ms || 0).toFixed(2)),
                ttft_ms: parseFloat((r.ttft_ms || 0).toFixed(2)),
                tps: parseFloat((r.tps || 0).toFixed(2)),
                jitter_ms: parseFloat((r.jitter_ms || 0).toFixed(2)),
                bandwidth_bps: parseFloat(r.bandwidth_bps || 0),
                proxy_buffer_detected: !!r.proxy_buffer_detected,
                rank: parseInt(r.rank || 0, 10),
                tested_at: r.tested_at || new Date().toISOString(),
                tested_time_display: r.tested_time_display || "",
                batch_time: r.batch_time || ""
            }));

            await window.go.main.App.SaveHistoryRecords(dbRecords);
            return;
        } catch (e) {
            console.error("Failed to save benchmark records to SQLite, falling back to localStorage:", e);
        }
    }

    // 浏览器 localStorage 降级存储与容量封顶保护
    try {
        let history = [];
        const existingData = localStorage.getItem(STORAGE_KEY_BENCHMARK_HISTORY);
        if (existingData) {
            try {
                history = JSON.parse(existingData) || [];
            } catch (e) {
                history = [];
            }
        } else {
            const currentResults = getStoredBenchmarkResults();
            if (Array.isArray(currentResults) && currentResults.length > 0) {
                history = [...currentResults];
            }
        }

        history.push(...records);

        if (history.length > 1000) {
            history = history.slice(history.length - 1000);
        }

        localStorage.setItem(STORAGE_KEY_BENCHMARK_HISTORY, JSON.stringify(history));
    } catch (e) {
        console.error("Failed to save benchmark history to localStorage:", e);
    }
}

/**
 * 将测速指标数据同步回灌至所属机场的节点对象中。
 * @param {Array} results - 测速结果数据列表
 */
export function syncBenchmarkResultsToAirports(results) {
    if (!Array.isArray(results) || results.length === 0) return;
    const airports = getStoredAirports();
    let hasChanges = false;

    // 1. 构建 node_name -> results 指标映射表
    const nodeResultsMap = new Map();
    results.forEach(r => {
        if (!nodeResultsMap.has(r.node_name)) {
            nodeResultsMap.set(r.node_name, []);
        }
        nodeResultsMap.get(r.node_name).push(r);
    });

    // 2. 遍历各机场节点并注入对应测速指标
    airports.forEach(airport => {
        const updateNodes = (list) => {
            if (!Array.isArray(list)) return;
            list.forEach(node => {
                const nodeResults = nodeResultsMap.get(node.name);
                if (nodeResults && applyNodeBenchmark(node, nodeResults, airport)) {
                    hasChanges = true;
                }
            });
        };

        updateNodes(airport.nodes);
        updateNodes(airport.rawNodes);
    });

    if (hasChanges) {
        saveStoredAirports(airports);
    }
}

/**
 * 清洗并将测速指标安全注入至单个节点对象中。
 * @param {Object} node - 目标节点对象
 * @param {Array} resultsList - 针对该节点的测速指标记录列表
 * @param {Object} airport - 所属机场对象
 * @returns {boolean} 是否成功应用了指标变更
 */
function applyNodeBenchmark(node, resultsList, airport) {
    if (!node || !Array.isArray(resultsList) || resultsList.length === 0) {
        return false;
    }

    if (!node.benchmarkResults) {
        node.benchmarkResults = {};
    }

    // 1. 按 AIOffer 维度记录详细指标
    resultsList.forEach(item => {
        const m = extractMetrics(item);
        node.benchmarkResults[m.ai_offer] = {
            airport_name: airport.name,
            airport_id: airport.id,
            node_name: node.name,
            node_type: node.type || "",
            server: node.server || "",
            port: node.port || 0,
            ai_offer: m.ai_offer,
            service_name: m.service_name,
            status: m.status,
            ttfb_ms: m.ttfb_ms,
            ttft_ms: m.ttft_ms,
            tps: m.tps,
            jitter_ms: m.jitter_ms,
            bandwidth_bps: m.ingress_bps,
            ingress_mbps: m.ingress_bps > 0 ? parseFloat((m.ingress_bps / (1024 * 1024)).toFixed(2)) : 0,
            proxy_buffer_detected: m.proxy_buffer_detected,
            score: m.score,
            tested_at: m.tested_at,
            tested_time_display: m.tested_time_display,
            evaluated_at: m.tested_time_display
        };
    });

    // 2. 选取综合评分最高的结果作为该节点的最新测速概览 (Latest Benchmark Summary)
    const best = resultsList.slice().sort((a, b) => b.score - a.score)[0];
    const bestM = extractMetrics(best);
    node.latestBenchmark = {
        airport_name: airport.name,
        airport_id: airport.id,
        node_name: node.name,
        ai_offer: bestM.ai_offer,
        service_name: bestM.service_name,
        status: bestM.status,
        ttfb_ms: bestM.ttfb_ms,
        ttft_ms: bestM.ttft_ms,
        tps: bestM.tps,
        jitter_ms: bestM.jitter_ms,
        bandwidth_bps: bestM.ingress_bps,
        ingress_mbps: bestM.ingress_bps > 0 ? parseFloat((bestM.ingress_bps / (1024 * 1024)).toFixed(2)) : 0,
        proxy_buffer_detected: bestM.proxy_buffer_detected,
        score: bestM.score,
        tested_at: bestM.tested_at,
        tested_time_display: bestM.tested_time_display,
        evaluated_at: bestM.tested_time_display
    };

    return true;
}

/**
 * 应用冷启动时初始化 SQLite 存储（机场/配置/规则/测速快照）并自动从 localStorage 迁移既有数据。
 */
export async function initSQLiteStorage() {
    if (!window.go || !window.go.main || !window.go.main.App) {
        return;
    }

    try {
        // 1. 机场列表初始化与自动迁移
        if (window.go.main.App.GetAirportsJSON) {
            const airportsStr = await window.go.main.App.GetAirportsJSON();
            let parsedAirports = [];
            try {
                parsedAirports = JSON.parse(airportsStr);
            } catch (e) {}

            if (Array.isArray(parsedAirports) && parsedAirports.length > 0) {
                cachedAirportsList = parsedAirports;
                const json = JSON.stringify(parsedAirports);
                for (const key of STORAGE_KEYS) {
                    localStorage.setItem(key, json);
                }
            } else {
                // 首次运行时自动将旧版 localStorage 机场数据迁移至 SQLite
                const legacy = getStoredAirports();
                if (Array.isArray(legacy) && legacy.length > 0) {
                    await window.go.main.App.SaveAirportsJSON(JSON.stringify(legacy));
                    cachedAirportsList = legacy;
                }
            }
        }

        // 2. 过滤规则预设库初始化与自动迁移
        if (window.go.main.App.GetRuleLibraryJSON) {
            const rulesStr = await window.go.main.App.GetRuleLibraryJSON();
            let parsedRules = [];
            try {
                parsedRules = JSON.parse(rulesStr);
            } catch (e) {}

            if (Array.isArray(parsedRules) && parsedRules.length > 0) {
                localStorage.setItem("nodepilot_filter_rule_library", JSON.stringify(parsedRules));
            } else {
                const legacyRules = localStorage.getItem("nodepilot_filter_rule_library");
                if (legacyRules) {
                    await window.go.main.App.SaveRuleLibraryJSON(legacyRules);
                }
            }
        }

        // 3. 最新测速结果快照初始化与自动迁移
        if (window.go.main.App.GetLatestBenchmarkResultsJSON) {
            const latestStr = await window.go.main.App.GetLatestBenchmarkResultsJSON();
            let parsedLatest = [];
            try {
                parsedLatest = JSON.parse(latestStr);
            } catch (e) {}

            if (Array.isArray(parsedLatest) && parsedLatest.length > 0) {
                cachedBenchmarkResults = parsedLatest;
                localStorage.setItem(STORAGE_KEY_BENCHMARK_RESULTS, JSON.stringify(parsedLatest));
            } else {
                const legacyResults = getStoredBenchmarkResults();
                if (Array.isArray(legacyResults) && legacyResults.length > 0) {
                    await window.go.main.App.SaveLatestBenchmarkResultsJSON(JSON.stringify(legacyResults));
                    cachedBenchmarkResults = legacyResults;
                }
            }
        }

        // 4. 批量同步与迁移全局偏好设置项
        if (window.go.main.App.GetAllAppSettings) {
            const settings = await window.go.main.App.GetAllAppSettings();
            if (settings && Object.keys(settings).length > 0) {
                for (const [k, v] of Object.entries(settings)) {
                    localStorage.setItem(k, v);
                }
            } else {
                const keysToSync = [
                    "nodepilot_default_workers",
                    "nodepilot_default_timeout",
                    "nodepilot_tcp_timeout",
                    "nodepilot_enable_pre_ping",
                    "nodepilot_enable_ingress",
                    "nodepilot_ingress_payload_size",
                    "nodepilot_jitter_threshold",
                    "nodepilot_top_n",
                    "nodepilot_min_score",
                    "nodepilot_auto_persist",
                    "nodepilot_skip_benchmark_confirm",
                    "nodepilot_log_level",
                    STORAGE_KEY_SELECTED_AIRPORTS,
                    "nodepilot_selected_services",
                    "nodepilot_theme",
                    "nodepilot_lang"
                ];
                const batch = {};
                for (const k of keysToSync) {
                    const val = localStorage.getItem(k);
                    if (val !== null) {
                        batch[k] = val;
                    }
                }
                if (Object.keys(batch).length > 0 && window.go.main.App.SaveAppSettingsBatch) {
                    await window.go.main.App.SaveAppSettingsBatch(batch);
                }
            }
        }
    } catch (e) {
        console.error("Failed to initialize SQLite storage:", e);
    }
}
