import test from "node:test";
import assert from "node:assert/strict";
import {
    clusterIntoBenchmarkSessions,
    passesScoreThreshold,
    filterRecords,
    formatShortTime,
    formatMetricVal,
    METRIC_GROUPS,
    METRICS_CONFIG,
    updateMetricSelection,
    getMetricTriggerText
} from "../src/js/history_chart.js";
import zh from "../src/js/i18n/locales/zh.js";
import en from "../src/js/i18n/locales/en.js";

test("History Chart - 120s Sliding Window Clustering within 120s window", () => {
    // Base timestamp: 2026-11-18 10:00:00 UTC (1763460000000)
    const baseTime = new Date("2026-11-18T10:00:00Z").getTime();

    const records = [
        {
            name: "HK-01",
            airport_name: "Airport A",
            tested_at: new Date(baseTime).toISOString(),
            score: 85
        },
        {
            name: "HK-02",
            airport_name: "Airport A",
            tested_at: new Date(baseTime + 30 * 1000).toISOString(), // +30s
            score: 78
        },
        {
            name: "JP-01",
            airport_name: "Airport B",
            tested_at: new Date(baseTime + 90 * 1000).toISOString(), // +90s (delta from previous 60s <= 120s)
            score: 92
        },
        {
            name: "US-01",
            airport_name: "Airport B",
            tested_at: new Date(baseTime + 120 * 1000).toISOString(), // +120s (delta from previous 30s <= 120s)
            score: 65
        }
    ];

    const sessions = clusterIntoBenchmarkSessions(records);

    // Adjacent nodes completed within <= 120s should cluster into a single session batch
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].records.length, 4);
    assert.strictEqual(sessions[0].records[0].name, "HK-01");
    assert.strictEqual(sessions[0].records[3].name, "US-01");
});

test("History Chart - 120s Sliding Window Splitting into Multiple Sessions", () => {
    const baseTime = new Date("2026-11-18T10:00:00Z").getTime();

    const records = [
        // Batch 1 (2 nodes)
        {
            name: "HK-01",
            tested_at: new Date(baseTime).toISOString(),
            score: 80
        },
        {
            name: "HK-02",
            tested_at: new Date(baseTime + 45 * 1000).toISOString(), // +45s
            score: 82
        },
        // Batch 2 (gap 180s > 120s)
        {
            name: "JP-01",
            tested_at: new Date(baseTime + (45 + 180) * 1000).toISOString(), // gap 180s
            score: 90
        },
        {
            name: "JP-02",
            tested_at: new Date(baseTime + (45 + 180 + 30) * 1000).toISOString(), // gap 30s
            score: 91
        },
        // Batch 3 (gap 300s > 120s)
        {
            name: "SG-01",
            tested_at: new Date(baseTime + (45 + 180 + 30 + 300) * 1000).toISOString(),
            score: 88
        }
    ];

    const sessions = clusterIntoBenchmarkSessions(records);

    assert.strictEqual(sessions.length, 3, "Should accurately split into 3 distinct session batches");
    assert.strictEqual(sessions[0].records.length, 2, "Batch 1 contains 2 nodes");
    assert.strictEqual(sessions[1].records.length, 2, "Batch 2 contains 2 nodes");
    assert.strictEqual(sessions[2].records.length, 1, "Batch 3 contains 1 node");

    assert.strictEqual(sessions[0].records[0].name, "HK-01");
    assert.strictEqual(sessions[1].records[0].name, "JP-01");
    assert.strictEqual(sessions[2].records[0].name, "SG-01");
});

test("History Chart - Out-of-Order Input Sorting Tolerance", () => {
    const t1 = new Date("2026-11-18T10:00:00Z").getTime();
    const t2 = new Date("2026-11-18T10:01:00Z").getTime(); // +60s
    const t3 = new Date("2026-11-18T10:10:00Z").getTime(); // +600s
    const t4 = new Date("2026-11-18T10:10:30Z").getTime(); // +630s

    // Scrambled out-of-order input
    const scrambledRecords = [
        { name: "Node-4", tested_at: new Date(t4).toISOString() },
        { name: "Node-1", tested_at: new Date(t1).toISOString() },
        { name: "Node-3", tested_at: new Date(t3).toISOString() },
        { name: "Node-2", tested_at: new Date(t2).toISOString() }
    ];

    const sessions = clusterIntoBenchmarkSessions(scrambledRecords);

    assert.strictEqual(sessions.length, 2, "Should cluster into 2 batches after auto-sorting");
    assert.deepStrictEqual(
        sessions[0].records.map(r => r.name),
        ["Node-1", "Node-2"],
        "Batch 1 should order Node-1 and Node-2 ascendingly"
    );
    assert.deepStrictEqual(
        sessions[1].records.map(r => r.name),
        ["Node-3", "Node-4"],
        "Batch 2 should order Node-3 and Node-4 ascendingly"
    );
});

test("History Chart - Empty & Single Record Boundaries", () => {
    // Empty records and malformed inputs
    assert.deepStrictEqual(clusterIntoBenchmarkSessions([]), []);
    assert.deepStrictEqual(clusterIntoBenchmarkSessions(null), []);
    assert.deepStrictEqual(clusterIntoBenchmarkSessions(undefined), []);

    // Single record
    const single = [{ name: "Sole-Node", tested_at: "2026-11-18T12:00:00Z", score: 95 }];
    const sessions = clusterIntoBenchmarkSessions(single);
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].records.length, 1);
    assert.strictEqual(sessions[0].records[0].name, "Sole-Node");
    assert.strictEqual(sessions[0].timestamp, new Date("2026-11-18T12:00:00Z").getTime());
});

test("History Chart - Explicit batch_time Grouping Priority", () => {
    // Nodes with matching batch_time cluster together even if delta > 120s
    const records = [
        {
            name: "Slow-Worker-1",
            batch_time: "2026-11-18 14:00:00",
            tested_at: "2026-11-18T14:00:00Z"
        },
        {
            name: "Slow-Worker-2",
            batch_time: "2026-11-18 14:00:00",
            tested_at: "2026-11-18T14:05:00Z" // +300s, but same explicit batch_time
        }
    ];

    const sessions = clusterIntoBenchmarkSessions(records);
    assert.strictEqual(sessions.length, 1, "Matching batch_time identifier takes priority in grouping");
    assert.strictEqual(sessions[0].records.length, 2);
});

test("History Chart - passesScoreThreshold Filter Logic", () => {
    // "all" always allows all
    assert.strictEqual(passesScoreThreshold(0, "all"), true);
    assert.strictEqual(passesScoreThreshold(50, "all"), true);
    assert.strictEqual(passesScoreThreshold(-10, "all"), true);
    assert.strictEqual(passesScoreThreshold(NaN, "all"), true);

    // "0" allows > 0
    assert.strictEqual(passesScoreThreshold(0.1, "0"), true);
    assert.strictEqual(passesScoreThreshold(0, "0"), false);
    assert.strictEqual(passesScoreThreshold(-5, "0"), false);

    // Concrete thresholds "30", "60", "80"
    assert.strictEqual(passesScoreThreshold(30, "30"), true);
    assert.strictEqual(passesScoreThreshold(29.9, "30"), false);
    assert.strictEqual(passesScoreThreshold(60, "60"), true);
    assert.strictEqual(passesScoreThreshold(59.9, "60"), false);
    assert.strictEqual(passesScoreThreshold(85, "80"), true);
    assert.strictEqual(passesScoreThreshold(79, "80"), false);

    // Fallbacks
    assert.strictEqual(passesScoreThreshold(null, "60"), false);
    assert.strictEqual(passesScoreThreshold(undefined, "60"), false);
    assert.strictEqual(passesScoreThreshold("abc", "60"), false);
    assert.strictEqual(passesScoreThreshold(50, "invalid-threshold"), true);
});

test("History Chart - formatShortTime & formatMetricVal Helpers", () => {
    // formatShortTime
    assert.strictEqual(formatShortTime(""), "");
    assert.strictEqual(formatShortTime(null), "");
    assert.strictEqual(formatShortTime("14:30:25"), "14:30:25");
    assert.strictEqual(formatShortTime("14:30"), "14:30");

    const isoStr = "2026-11-18T14:20:10.000Z";
    const shortT = formatShortTime(isoStr);
    assert.match(shortT, /^\d{2}:\d{2}:\d{2}$/);

    // formatMetricVal
    assert.strictEqual(formatMetricVal(NaN, "score"), "-");
    assert.strictEqual(formatMetricVal(null, "score"), "-");
    assert.strictEqual(formatMetricVal(undefined, "score"), "-");
    assert.strictEqual(formatMetricVal(95.45, "score"), "95.5 pts");
    assert.strictEqual(formatMetricVal(42.3, "ping"), "42 ms");
    assert.strictEqual(formatMetricVal(125.8, "ttft"), "126 ms");
    assert.strictEqual(formatMetricVal(48.2, "tps"), "48.2 TPS");
    assert.strictEqual(formatMetricVal(15.6, "ttfb"), "16 ms");
});

test("History Chart - filterRecords Boundary & Default Passthrough", () => {
    // Empty & malformed inputs
    assert.deepStrictEqual(filterRecords([]), []);
    assert.deepStrictEqual(filterRecords(null), []);
    assert.deepStrictEqual(filterRecords(undefined), []);

    const sampleRecords = [
        { node_name: "HK-01", airport_name: "Airport A", score: 85, tested_at: "2026-11-18T10:00:00Z" },
        { node_name: "HK-02", airport_name: "Airport A", score: 0, tested_at: "2026-11-18T10:00:00Z" }
    ];

    // "all" preserves everything
    const resAll = filterRecords(sampleRecords, { groupBy: "node", scoreFilter: "all" });
    assert.strictEqual(resAll.length, 2);
});

test("History Chart - filterRecords: Working Nodes (> 0) Retains Nodes with Intermittent Outages", () => {
    // Simulating user scenario from image-2.png:
    // Multiple nodes have valid tests, but all suffered a temporary disconnection at 11-17 22:12 (score: 0)
    const t1 = "2026-11-17T11:29:00Z";
    const t2 = "2026-11-17T20:16:00Z";
    const tOutage = "2026-11-17T22:12:00Z"; // Temporary disconnection
    const t3 = "2026-11-18T18:07:00Z"; // Recovery

    const records = [
        // Node 1: Normal working node with mid-test disconnection
        { node_name: "Node-US-01", airport_name: "Airport-A", score: 75, tested_at: t1 },
        { node_name: "Node-US-01", airport_name: "Airport-A", score: 82, tested_at: t2 },
        { node_name: "Node-US-01", airport_name: "Airport-A", score: 0, tested_at: tOutage },
        { node_name: "Node-US-01", airport_name: "Airport-A", score: 85, tested_at: t3 },

        // Node 2: Another working node with mid-test disconnection
        { node_name: "Node-HK-02", airport_name: "Airport-A", score: 68, tested_at: t1 },
        { node_name: "Node-HK-02", airport_name: "Airport-A", score: 70, tested_at: t2 },
        { node_name: "Node-HK-02", airport_name: "Airport-A", score: 0, tested_at: tOutage },
        { node_name: "Node-HK-02", airport_name: "Airport-A", score: 78, tested_at: t3 },

        // Node 3: Completely dead node (all tests 0)
        { node_name: "Node-Dead-03", airport_name: "Airport-A", score: 0, tested_at: t1 },
        { node_name: "Node-Dead-03", airport_name: "Airport-A", score: 0, tested_at: t2 },
        { node_name: "Node-Dead-03", airport_name: "Airport-A", score: 0, tested_at: tOutage },
        { node_name: "Node-Dead-03", airport_name: "Airport-A", score: 0, tested_at: t3 }
    ];

    // Filter with "> 0 pts (Working Nodes)"
    const filtered = filterRecords(records, { groupBy: "node", scoreFilter: "0" });

    // Working nodes Node-US-01 and Node-HK-02 MUST be retained
    const nodeNames = new Set(filtered.map(r => r.node_name));
    assert.strictEqual(nodeNames.has("Node-US-01"), true, "Node-US-01 must be retained despite temporary disconnect");
    assert.strictEqual(nodeNames.has("Node-HK-02"), true, "Node-HK-02 must be retained despite temporary disconnect");
    assert.strictEqual(nodeNames.has("Node-Dead-03"), false, "100% Dead node must be excluded");

    // All records of retained nodes (including the 0-score dip at tOutage) MUST be preserved
    // so that the chart renders the complete historical curve
    const usRecords = filtered.filter(r => r.node_name === "Node-US-01");
    assert.strictEqual(usRecords.length, 4, "All 4 historical data points for Node-US-01 must be preserved");
    const outagePoint = usRecords.find(r => r.tested_at === tOutage);
    assert.ok(outagePoint, "Outage data point must be kept for accurate curve drawing");
    assert.strictEqual(outagePoint.score, 0);
});

test("History Chart - filterRecords: Latest Test Outage Does Not Wipe Out Chart", () => {
    // Scenario where an outage happened during the MOST RECENT benchmark run
    const tPrev = "2026-11-18T10:00:00Z";
    const tLatestOutage = "2026-11-18T12:00:00Z";

    const records = [
        // Node A: worked before, latest failed
        { node_name: "Node-A", airport_name: "AP-1", score: 92, tested_at: tPrev },
        { node_name: "Node-A", airport_name: "AP-1", score: 0, tested_at: tLatestOutage },

        // Node B: worked before, latest failed
        { node_name: "Node-B", airport_name: "AP-1", score: 88, tested_at: tPrev },
        { node_name: "Node-B", airport_name: "AP-1", score: 0, tested_at: tLatestOutage },

        // Node C: always failed
        { node_name: "Node-C", airport_name: "AP-1", score: 0, tested_at: tPrev },
        { node_name: "Node-C", airport_name: "AP-1", score: 0, tested_at: tLatestOutage }
    ];

    const filtered = filterRecords(records, { groupBy: "node", scoreFilter: "0" });

    // Under the old flawed logic, latestScore was 0 for all nodes, making the chart empty.
    // Under the fixed logic, Node-A and Node-B must be retained.
    const nodeNames = new Set(filtered.map(r => r.node_name));
    assert.strictEqual(nodeNames.size, 2, "Chart must not become empty; 2 working nodes must be retained");
    assert.strictEqual(nodeNames.has("Node-A"), true);
    assert.strictEqual(nodeNames.has("Node-B"), true);
    assert.strictEqual(nodeNames.has("Node-C"), false);
});

test("History Chart - filterRecords: Quality Tier Filtering (>= 30, >= 60, >= 80)", () => {
    const records = [
        // Excellent node (reaches 88, dipped once to 0)
        { node_name: "Excellent-Node", airport_name: "AP", score: 85, tested_at: "2026-11-18T10:00:00Z" },
        { node_name: "Excellent-Node", airport_name: "AP", score: 0, tested_at: "2026-11-18T11:00:00Z" },
        { node_name: "Excellent-Node", airport_name: "AP", score: 88, tested_at: "2026-11-18T12:00:00Z" },

        // Good node (reaches 65, never >= 80)
        { node_name: "Good-Node", airport_name: "AP", score: 62, tested_at: "2026-11-18T10:00:00Z" },
        { node_name: "Good-Node", airport_name: "AP", score: 65, tested_at: "2026-11-18T12:00:00Z" },

        // Low node (reaches 25, never >= 30)
        { node_name: "Low-Node", airport_name: "AP", score: 20, tested_at: "2026-11-18T10:00:00Z" },
        { node_name: "Low-Node", airport_name: "AP", score: 25, tested_at: "2026-11-18T12:00:00Z" }
    ];

    // >= 80 pts (Excellent)
    const res80 = filterRecords(records, { groupBy: "node", scoreFilter: "80" });
    const nodes80 = new Set(res80.map(r => r.node_name));
    assert.strictEqual(nodes80.has("Excellent-Node"), true);
    assert.strictEqual(nodes80.has("Good-Node"), false);
    assert.strictEqual(nodes80.has("Low-Node"), false);

    // >= 60 pts (Good)
    const res60 = filterRecords(records, { groupBy: "node", scoreFilter: "60" });
    const nodes60 = new Set(res60.map(r => r.node_name));
    assert.strictEqual(nodes60.has("Excellent-Node"), true);
    assert.strictEqual(nodes60.has("Good-Node"), true);
    assert.strictEqual(nodes60.has("Low-Node"), false);

    // >= 30 pts
    const res30 = filterRecords(records, { groupBy: "node", scoreFilter: "30" });
    const nodes30 = new Set(res30.map(r => r.node_name));
    assert.strictEqual(nodes30.has("Excellent-Node"), true);
    assert.strictEqual(nodes30.has("Good-Node"), true);
    assert.strictEqual(nodes30.has("Low-Node"), false);
});

test("History Chart - filterRecords: Supports 'name' and 'node_name' Fallbacks and Airport Filtering", () => {
    const records = [
        // Uses 'name' instead of 'node_name'
        { name: "Node-AP1", airport_name: "Airport-1", score: 75, tested_at: "2026-11-18T10:00:00Z" },
        // Uses 'node_name'
        { node_name: "Node-AP2", airport_name: "Airport-2", score: 80, tested_at: "2026-11-18T10:00:00Z" }
    ];

    // Airport filter
    const resAp1 = filterRecords(records, { groupBy: "node", airportFilter: "Airport-1", scoreFilter: "all" });
    assert.strictEqual(resAp1.length, 1);
    assert.strictEqual(resAp1[0].name, "Node-AP1");

    const resAp2 = filterRecords(records, { groupBy: "node", airportFilter: "Airport-2", scoreFilter: "all" });
    assert.strictEqual(resAp2.length, 1);
    assert.strictEqual(resAp2[0].node_name, "Node-AP2");

    // Score filter with 'name' property
    const resScore = filterRecords(records, { groupBy: "node", airportFilter: "all", scoreFilter: "0" });
    assert.strictEqual(resScore.length, 2);
});

test("History Chart - Task 12 Metric Polarity Grouping & Config Verification", () => {
    assert.ok(METRIC_GROUPS.higher, "METRIC_GROUPS.higher must be defined");
    assert.ok(METRIC_GROUPS.lower, "METRIC_GROUPS.lower must be defined");
    assert.strictEqual(METRIC_GROUPS.higher.higherIsBetter, true);
    assert.strictEqual(METRIC_GROUPS.lower.higherIsBetter, false);

    // Verify all metrics belong strictly to 'higher' or 'lower'
    METRICS_CONFIG.forEach(m => {
        assert.ok(["higher", "lower"].includes(m.group), `Metric ${m.key} must belong to 'higher' or 'lower' group`);
        if (m.group === "higher") {
            assert.strictEqual(m.higherIsBetter, true, `Metric ${m.key} in higher group must have higherIsBetter: true`);
        } else {
            assert.strictEqual(m.higherIsBetter, false, `Metric ${m.key} in lower group must have higherIsBetter: false`);
        }
    });

    // Check Higher group members
    const higherKeys = METRICS_CONFIG.filter(m => m.group === "higher").map(m => m.key);
    assert.deepStrictEqual(higherKeys, ["score", "tps"]);

    // Check Lower group members
    const lowerKeys = METRICS_CONFIG.filter(m => m.group === "lower").map(m => m.key);
    assert.deepStrictEqual(lowerKeys, ["ping", "ttft", "ttfb"]);
});

test("History Chart - Task 12 updateMetricSelection Mutual Exclusion & Isolation", () => {
    // 1. Initial state: ['score'] (Higher group)
    // Clicking 'ping' (Lower group) -> should immediately clear 'score' and switch to ['ping']
    const toLower = updateMetricSelection(["score"], "ping", true);
    assert.deepStrictEqual(toLower, ["ping"], "Switching to Lower group must isolate to target metric");

    // 2. In Lower group: adding 'ttft' -> ['ping', 'ttft'] (same group multi-select)
    const twoLower = updateMetricSelection(["ping"], "ttft", true);
    assert.deepStrictEqual(twoLower, ["ping", "ttft"], "Same group allows concurrent multi-metrics");

    // 3. In Lower group: adding 3rd metric 'ttfb' -> caps at 2 (sliding window)
    const capped = updateMetricSelection(["ping", "ttft"], "ttfb", true);
    assert.deepStrictEqual(capped, ["ttft", "ttfb"], "Capped at max 2 metrics for visual clarity");

    // 4. Switching back to Higher group: clicking 'tps' -> immediately clears Lower metrics
    const backToHigher = updateMetricSelection(["ttft", "ttfb"], "tps", true);
    assert.deepStrictEqual(backToHigher, ["tps"], "Switching to Higher group must isolate to target metric");

    // 5. In Higher group: adding 'score' -> ['tps', 'score']
    const twoHigher = updateMetricSelection(["tps"], "score", true);
    assert.deepStrictEqual(twoHigher, ["tps", "score"], "Higher group allows concurrent metrics");

    // 6. Unchecking: removing 'score' -> ['tps']
    const unchecked = updateMetricSelection(["tps", "score"], "score", false);
    assert.deepStrictEqual(unchecked, ["tps"], "Unchecking one metric retains remaining metric in group");

    // 7. Unchecking last remaining metric: must NOT allow 0 metrics selected
    const uncheckLast = updateMetricSelection(["tps"], "tps", false);
    assert.deepStrictEqual(uncheckLast, ["tps"], "Must prevent unchecking the only remaining metric");
});

test("History Chart - Task 12 i18n Group Header Dictionaries", () => {
    assert.ok(zh.history.group_higher, "zh.history.group_higher must exist");
    assert.ok(zh.history.group_lower, "zh.history.group_lower must exist");
    assert.ok(zh.history.group_higher_short, "zh.history.group_higher_short must exist");
    assert.ok(zh.history.group_lower_short, "zh.history.group_lower_short must exist");

    assert.ok(en.history.group_higher, "en.history.group_higher must exist");
    assert.ok(en.history.group_lower, "en.history.group_lower must exist");
    assert.ok(en.history.group_higher_short, "en.history.group_higher_short must exist");
    assert.ok(en.history.group_lower_short, "en.history.group_lower_short must exist");
});

test("History Chart - Task 12 getMetricTriggerText Representation", () => {
    // Single higher metric
    const textSingleHigher = getMetricTriggerText(["score"]);
    assert.ok(textSingleHigher.includes("Score"));

    // Single lower metric
    const textSingleLower = getMetricTriggerText(["ping"]);
    assert.ok(textSingleLower.includes("Ping"));

    // Multi lower metrics
    const textMultiLower = getMetricTriggerText(["ping", "ttft"]);
    assert.ok(textMultiLower.includes("2"));

    // Multi higher metrics
    const textMultiHigher = getMetricTriggerText(["score", "tps"]);
    assert.ok(textMultiHigher.includes("2"));
});

test("History Chart - Point Markers Clean Circles (No Triangles) & Streamlined Items", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const jsPath = path.resolve(__dirname, "../src/js/history_chart.js");
    const jsContent = fs.readFileSync(jsPath, "utf-8");

    // 1. Verify renderPointMarker outputs circle instead of polygon
    assert.ok(jsContent.includes("<circle cx="), "Point marker must render as <circle>");
    assert.ok(!jsContent.includes("<polygon points="), "Point marker must NOT render triangle <polygon>");

    // 2. Verify per-item redundant dir badges are removed
    assert.ok(!jsContent.includes("history-metric-dir-badge higher"), "Per-item higher badge must be removed");
    assert.ok(!jsContent.includes("history-metric-dir-badge lower"), "Per-item lower badge must be removed");
});

