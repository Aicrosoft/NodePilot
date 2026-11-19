import test from "node:test";
import assert from "node:assert/strict";
import {
    generateClashYAML,
    generateShadowrocketURIs,
    generateBase64Subscription
} from "../src/js/vpn_exporter.js";

const SAMPLE_EXPORT_NODES = [
    {
        name: "🇭🇰 HK-BGP-01",
        server: "hk1.nodepilot.com",
        port: 443,
        type: "hysteria2",
        password: "secret-hy2-pass",
        raw: {
            sni: "hk1.nodepilot.com",
            "skip-cert-verify": true
        }
    },
    {
        name: "🇯🇵 JP-Trojan-01",
        server: "jp1.nodepilot.com",
        port: 443,
        type: "trojan",
        password: "secret-trojan-pass",
        raw: {
            sni: "jp1.nodepilot.com",
            "skip-cert-verify": false
        }
    },
    {
        name: "🇺🇸 US-SS-01",
        server: "us1.nodepilot.com",
        port: 8388,
        type: "ss",
        password: "secret-ss-pass",
        raw: {
            cipher: "aes-256-gcm"
        }
    },
    {
        name: "🇸🇬 SG-VMess-01",
        server: "sg1.nodepilot.com",
        port: 10086,
        type: "vmess",
        password: "a0b1c2d3-e4f5-6789-0123-456789abcdef",
        raw: {
            network: "ws",
            tls: true
        }
    },
    {
        name: "🇹🇼 TW-VLESS-01",
        server: "tw1.nodepilot.com",
        port: 443,
        type: "vless",
        password: "b0c1d2e3-f4a5-6789-0123-abcdef012345",
        raw: {
            sni: "tw1.nodepilot.com",
            tls: true
        }
    }
];

test("VPN Exporter - Clash YAML General Config & Headers", () => {
    const yaml = generateClashYAML(SAMPLE_EXPORT_NODES, "NodePilot-VIP");

    // 1. Verify meta comment headers
    assert.match(yaml, /# 机场\/订阅: NodePilot-VIP/);
    assert.match(yaml, /# 优选节点数: 5/);

    // 2. Verify basic listener port configuration
    assert.match(yaml, /port: 7890/);
    assert.match(yaml, /socks-port: 7891/);
    assert.match(yaml, /mode: rule/);
    assert.match(yaml, /log-level: info/);
    assert.match(yaml, /external-controller: 127\.0\.0\.1:9090/);
});

test("VPN Exporter - Clash YAML Proxies Block Generation", () => {
    const yaml = generateClashYAML(SAMPLE_EXPORT_NODES, "NodePilot");

    assert.match(yaml, /proxies:/);

    // Verify proxy node serialization for each protocol
    assert.match(yaml, /- name: "🇭🇰 HK-BGP-01"/);
    assert.match(yaml, /type: hysteria2/);
    assert.match(yaml, /server: hk1\.nodepilot\.com/);
    assert.match(yaml, /password: "secret-hy2-pass"/);

    assert.match(yaml, /- name: "🇯🇵 JP-Trojan-01"/);
    assert.match(yaml, /type: trojan/);

    assert.match(yaml, /- name: "🇺🇸 US-SS-01"/);
    assert.match(yaml, /type: ss/);

    assert.match(yaml, /- name: "🇸🇬 SG-VMess-01"/);
    assert.match(yaml, /uuid: a0b1c2d3-e4f5-6789-0123-456789abcdef/);

    assert.match(yaml, /- name: "🇹🇼 TW-VLESS-01"/);
    assert.match(yaml, /uuid: b0c1d2e3-f4a5-6789-0123-abcdef012345/);
});

test("VPN Exporter - Clash Proxy-Groups (url-test & select) Generation", () => {
    const yaml = generateClashYAML(SAMPLE_EXPORT_NODES, "NodePilot");

    assert.match(yaml, /proxy-groups:/);

    // 1. Verify url-test benchmark group
    assert.match(yaml, /- name: "⚡ 优选节点-自动选优"/);
    assert.match(yaml, /type: url-test/);
    assert.match(yaml, /url: http:\/\/www\.gstatic\.com\/generate_204/);
    assert.match(yaml, /interval: 300/);
    assert.match(yaml, /tolerance: 50/);

    // 2. Verify all nodes are injected into url-test proxies list
    for (const node of SAMPLE_EXPORT_NODES) {
        assert.match(yaml, new RegExp(`- "${node.name}"`));
    }

    // 3. 验证主 PROXY 选择组与 DIRECT 选项
    assert.match(yaml, /- name: "🚀 PROXY"/);
    assert.match(yaml, /type: select/);
    assert.match(yaml, /- "⚡ 优选节点-自动选优"/);
    assert.match(yaml, /- DIRECT/);
});

test("VPN Exporter - Clash AI Routing Diversion Rules", () => {
    const yaml = generateClashYAML(SAMPLE_EXPORT_NODES, "NodePilot");

    assert.match(yaml, /rules:/);

    // 验证核心 AI 服务的域名后缀分流到 PROXY
    assert.match(yaml, /DOMAIN-SUFFIX,googleapis\.com,PROXY/);
    assert.match(yaml, /DOMAIN-SUFFIX,openai\.com,PROXY/);
    assert.match(yaml, /DOMAIN-SUFFIX,anthropic\.com,PROXY/);
    assert.match(yaml, /DOMAIN-SUFFIX,cursor\.sh,PROXY/);

    // 验证全局兜底规则
    assert.match(yaml, /MATCH,PROXY/);
});

test("VPN Exporter - Shadowrocket URI Schemes & Base64 Subscription", () => {
    const uris = generateShadowrocketURIs(SAMPLE_EXPORT_NODES);
    assert.strictEqual(uris.length, 5);

    // 1. Hysteria2 URI
    const hy2Uri = uris.find(u => u.startsWith("hysteria2://"));
    assert.ok(hy2Uri);
    assert.match(hy2Uri, /secret-hy2-pass@hk1\.nodepilot\.com:443/);
    assert.match(hy2Uri, /sni=hk1\.nodepilot\.com/);
    assert.match(hy2Uri, /insecure=1/);

    // 2. Trojan URI
    const trojanUri = uris.find(u => u.startsWith("trojan://"));
    assert.ok(trojanUri);
    assert.match(trojanUri, /secret-trojan-pass@jp1\.nodepilot\.com:443/);

    // 3. Shadowsocks URI
    const ssUri = uris.find(u => u.startsWith("ss://"));
    assert.ok(ssUri);
    assert.match(ssUri, /@us1\.nodepilot\.com:8388/);

    // 4. VMess URI
    const vmessUri = uris.find(u => u.startsWith("vmess://"));
    assert.ok(vmessUri);

    // 5. VLESS URI
    const vlessUri = uris.find(u => u.startsWith("vless://"));
    assert.ok(vlessUri);
    assert.match(vlessUri, /b0c1d2e3-f4a5-6789-0123-abcdef012345@tw1\.nodepilot\.com:443/);

    // 6. Base64 订阅生成与解码还原
    const b64 = generateBase64Subscription(SAMPLE_EXPORT_NODES);
    assert.ok(b64.length > 0);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    for (const uri of uris) {
        assert.ok(decoded.includes(uri.split("#")[0])); // 基础链接存在于订阅中
    }
});

test("VPN Exporter - Empty Node List Handling", () => {
    // 1. 空数组生成骨架配置 (优选节点数 0)
    const emptyYAML = generateClashYAML([], "EmptyAP");
    assert.match(emptyYAML, /# 优选节点数: 0/);
    assert.match(emptyYAML, /proxies:\n\nproxy-groups:/);

    // 2. 非数组输入安全返回空字符串
    assert.strictEqual(generateClashYAML(null), "");
    assert.strictEqual(generateClashYAML(undefined), "");

    // 3. Shadowrocket 针对空数组和非数组输入安全返回空
    assert.deepStrictEqual(generateShadowrocketURIs([]), []);
    assert.deepStrictEqual(generateShadowrocketURIs(null), []);
    assert.deepStrictEqual(generateShadowrocketURIs(undefined), []);
    assert.strictEqual(generateBase64Subscription([]), "");
    assert.strictEqual(generateBase64Subscription(null), "");
});
