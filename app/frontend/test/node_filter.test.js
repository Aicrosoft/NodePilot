import test from "node:test";
import assert from "node:assert/strict";
import { applyNodeFilters, FILTER_PRESET_LIBRARY } from "../src/js/node_filter.js";

const SAMPLE_NODES = [
    { name: "🇭🇰 HK-BGP-01 [1.0x]", server: "hk1.node.com", port: 443, type: "hysteria2" },
    { name: "Hong Kong IPLC 专线", server: "hk2.node.com", port: 443, type: "trojan" },
    { name: "🇯🇵 Tokyo 日本 01 (原生/Netflix/AI)", server: "jp1.node.com", port: 443, type: "ss" },
    { name: "🇺🇸 US-Silicon-Valley-01", server: "us1.node.com", port: 443, type: "vmess" },
    { name: "🇸🇬 Singapore 狮城 01", server: "sg1.node.com", port: 443, type: "vless" },
    { name: "🇹🇼 Taiwan 台北 01 [2x]", server: "tw1.node.com", port: 443, type: "trojan" },
    { name: "📢 官网地址: https://nodepilot.com", server: "127.0.0.1", port: 80, type: "ss" },
    { name: "⏳ 剩余流量 256GB - 2026到期", server: "127.0.0.1", port: 80, type: "ss" },
    { name: "⚠️ 节点已失效请重新复制", server: "0.0.0.0", port: 80, type: "ss" },
    { name: "🇭🇰 HK-High-Rate [5x高倍率]", server: "hk5.node.com", port: 443, type: "hysteria2" },
    { name: "🇰🇷 Korea 首尔 01 [0.1x]", server: "kr1.node.com", port: 443, type: "hysteria2" }
];

test("Node Filter - Boundary & Empty Input Guards", () => {
    // 1. Empty input or invalid types return empty array
    assert.deepStrictEqual(applyNodeFilters([], {}), []);
    assert.deepStrictEqual(applyNodeFilters(null, {}), []);
    assert.deepStrictEqual(applyNodeFilters(undefined, {}), []);

    // 2. Empty rules return a shallow copy of original list
    const resultNoRules = applyNodeFilters(SAMPLE_NODES, {});
    assert.strictEqual(resultNoRules.length, SAMPLE_NODES.length);
    assert.notStrictEqual(resultNoRules, SAMPLE_NODES); // Copy, not same reference

    const resultEmptyRuleStrings = applyNodeFilters(SAMPLE_NODES, { include: "   ", exclude: "   " });
    assert.strictEqual(resultEmptyRuleStrings.length, SAMPLE_NODES.length);
});

test("Node Filter - Positive Inclusion (Include Regex)", () => {
    // Include Hong Kong nodes (HK|Hong Kong)
    const hkRules = {
        include: "(HK|Hong Kong)",
        exclude: "",
        caseInsensitive: true
    };
    const hkFiltered = applyNodeFilters(SAMPLE_NODES, hkRules);

    // Should retain 3 Hong Kong nodes: HK-BGP-01, Hong Kong IPLC, HK-High-Rate
    assert.strictEqual(hkFiltered.length, 3);
    for (const node of hkFiltered) {
        assert.match(node.name, /(HK|Hong Kong)/i);
    }

    // Match server domain or protocol type
    const hysteriaRules = {
        include: "hysteria2",
        exclude: ""
    };
    const hy2Filtered = applyNodeFilters(SAMPLE_NODES, hysteriaRules);
    assert.strictEqual(hy2Filtered.length, 3); // HK-BGP-01, HK-High-Rate, Korea Seoul
});

test("Node Filter - Negative Exclusion (Exclude Regex)", () => {
    // Exclude ads, announcements, expiration notices
    const cleanRules = {
        include: "",
        exclude: "(官网|到期|剩余|失效)",
        caseInsensitive: true
    };
    const cleaned = applyNodeFilters(SAMPLE_NODES, cleanRules);

    // 11 total minus 3 dirty nodes leaves 8 nodes
    assert.strictEqual(cleaned.length, 8);
    for (const node of cleaned) {
        assert.doesNotMatch(node.name, /(官网|到期|剩余|失效)/);
    }
});

test("Node Filter - Simultaneous Include and Exclude", () => {
    // Include Hong Kong nodes, but exclude high rate (5x)
    const rules = {
        include: "(HK|Hong Kong)",
        exclude: "(5x|高倍率)",
        caseInsensitive: true
    };
    const filtered = applyNodeFilters(SAMPLE_NODES, rules);

    // Retains 2 Hong Kong nodes (excludes HK-High-Rate)
    assert.strictEqual(filtered.length, 2);
    const names = filtered.map(n => n.name);
    assert.ok(names.includes("🇭🇰 HK-BGP-01 [1.0x]"));
    assert.ok(names.includes("Hong Kong IPLC 专线"));
    assert.ok(!names.includes("🇭🇰 HK-High-Rate [5x高倍率]"));
});

test("Node Filter - Case Sensitivity Switch", () => {
    // 1. Case-insensitive (default/true)
    const lowerInclude = {
        include: "hk",
        exclude: "",
        caseInsensitive: true
    };
    const matchedInsensitive = applyNodeFilters(SAMPLE_NODES, lowerInclude);
    assert.strictEqual(matchedInsensitive.length, 3);

    // 2. Case-sensitive (caseInsensitive: false)
    const sensitiveNodes = [
        { name: "HK-Node", server: "1.1.1.1", type: "ss" },
        { name: "hk-node", server: "1.1.1.2", type: "ss" }
    ];
    const sensitiveMatch = applyNodeFilters(sensitiveNodes, {
        include: "HK",
        caseInsensitive: false
    });
    assert.strictEqual(sensitiveMatch.length, 1);
    assert.strictEqual(sensitiveMatch[0].name, "HK-Node");

    const sensitiveMatchLower = applyNodeFilters(sensitiveNodes, {
        include: "hk",
        caseInsensitive: false
    });
    assert.strictEqual(sensitiveMatchLower.length, 1);
    assert.strictEqual(sensitiveMatchLower[0].name, "hk-node");
});

test("Node Filter - Malformed Regex Fault Tolerance", () => {
    // Invalid regex syntax should not throw and should safely degrade
    const brokenInclude = {
        include: "([unclosed-bracket",
        exclude: ""
    };
    assert.doesNotThrow(() => {
        const res = applyNodeFilters(SAMPLE_NODES, brokenInclude);
        assert.strictEqual(res.length, SAMPLE_NODES.length);
    });

    const brokenExclude = {
        include: "",
        exclude: "(*invalid-quantifier"
    };
    assert.doesNotThrow(() => {
        const res = applyNodeFilters(SAMPLE_NODES, brokenExclude);
        assert.strictEqual(res.length, SAMPLE_NODES.length);
    });
});

test("Node Filter - 10 Built-in Preset Rules Library Match Logic", () => {
    assert.strictEqual(FILTER_PRESET_LIBRARY.length, 10);

    // 1. builtin_clean_ads: clean ads and notices
    const cleanAdsPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_clean_ads");
    assert.ok(cleanAdsPreset);
    const afterCleanAds = applyNodeFilters(SAMPLE_NODES, {
        include: cleanAdsPreset.include,
        exclude: cleanAdsPreset.exclude
    });
    assert.strictEqual(afterCleanAds.length, 7);
    for (const n of afterCleanAds) {
        assert.doesNotMatch(n.name, /(失效|重新复制|到期|剩余|官网|0\.1x)/);
    }

    // 2. builtin_ai_dedicated: AI dedicated nodes (exclude HK, 0.1x, keep US, JP, SG, TW)
    const aiPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_ai_dedicated");
    assert.ok(aiPreset);
    const afterAi = applyNodeFilters(SAMPLE_NODES, {
        include: aiPreset.include,
        exclude: aiPreset.exclude
    });
    assert.strictEqual(afterAi.length, 4);
    for (const n of afterAi) {
        assert.doesNotMatch(n.name, /(香港|HK|0\.1x)/i);
    }

    // 3. builtin_east_asia: East Asia low latency (HK, JP, SG, KR, TW)
    const eastAsiaPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_east_asia");
    assert.ok(eastAsiaPreset);
    const afterEastAsia = applyNodeFilters(SAMPLE_NODES, {
        include: eastAsiaPreset.include,
        exclude: eastAsiaPreset.exclude
    });
    assert.ok(afterEastAsia.length >= 5);

    // 4. builtin_hk_only: retain HK nodes only
    const hkPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_hk_only");
    const afterHk = applyNodeFilters(SAMPLE_NODES, {
        include: hkPreset.include,
        exclude: hkPreset.exclude
    });
    assert.strictEqual(afterHk.length, 3);
    for (const n of afterHk) {
        assert.match(n.name, /(香港|HK|Hong Kong)/i);
    }

    // 5. builtin_jp_only: retain JP nodes only
    const jpPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_jp_only");
    const afterJp = applyNodeFilters(SAMPLE_NODES, {
        include: jpPreset.include,
        exclude: jpPreset.exclude
    });
    assert.strictEqual(afterJp.length, 1);
    assert.match(afterJp[0].name, /日本/);

    // 6. builtin_us_only: retain US nodes only
    const usPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_us_only");
    const afterUs = applyNodeFilters(SAMPLE_NODES, {
        include: usPreset.include,
        exclude: usPreset.exclude
    });
    assert.strictEqual(afterUs.length, 1);
    assert.match(afterUs[0].name, /US-Silicon/);

    // 7. builtin_sg_only: retain SG nodes only
    const sgPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_sg_only");
    const afterSg = applyNodeFilters(SAMPLE_NODES, {
        include: sgPreset.include,
        exclude: sgPreset.exclude
    });
    assert.strictEqual(afterSg.length, 1);
    assert.match(afterSg[0].name, /Singapore/);

    // 8. builtin_streaming_unlock: streaming & AI unlock
    const streamPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_streaming_unlock");
    const afterStream = applyNodeFilters(SAMPLE_NODES, {
        include: streamPreset.include,
        exclude: streamPreset.exclude
    });
    assert.strictEqual(afterStream.length, 2);
    const streamNames = afterStream.map(n => n.name);
    assert.ok(streamNames.includes("🇯🇵 Tokyo 日本 01 (原生/Netflix/AI)"));

    // 9. builtin_direct_iplc: IPLC dedicated line
    const iplcPreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_direct_iplc");
    const afterIplc = applyNodeFilters(SAMPLE_NODES, {
        include: iplcPreset.include,
        exclude: iplcPreset.exclude
    });
    assert.strictEqual(afterIplc.length, 2);
    const iplcNames = afterIplc.map(n => n.name);
    assert.ok(iplcNames.includes("Hong Kong IPLC 专线"));
    assert.ok(iplcNames.includes("🇭🇰 HK-BGP-01 [1.0x]"));

    // 10. builtin_low_rate: <= 1.0x low rate
    const lowRatePreset = FILTER_PRESET_LIBRARY.find(p => p.id === "builtin_low_rate");
    const afterLowRate = applyNodeFilters(SAMPLE_NODES, {
        include: lowRatePreset.include,
        exclude: lowRatePreset.exclude
    });
    for (const n of afterLowRate) {
        assert.doesNotMatch(n.name, /([2-9]x|[1-9][0-9]x|高倍|2倍|3倍|5倍)/);
    }
    const lowRateNames = afterLowRate.map(n => n.name);
    assert.ok(!lowRateNames.includes("🇭🇰 HK-High-Rate [5x高倍率]"));
    assert.ok(lowRateNames.includes("🇭🇰 HK-BGP-01 [1.0x]"));
    assert.ok(lowRateNames.includes("🇰🇷 Korea 首尔 01 [0.1x]"));
});
