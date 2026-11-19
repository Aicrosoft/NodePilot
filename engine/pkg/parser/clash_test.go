// Package parser 包含针对 Clash YAML、Base64 订阅与各类代理协议 URI 的单元测试与异常防御用例。
package parser

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestParseClashFromBytes(t *testing.T) {
	yamlContent := `
port: 7890
socks-port: 7891
proxies:
  - name: "JP-Tokyo-01"
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-128-gcm
    password: "test-password"
  - name: "US-Silicon-02"
    type: socks5
    server: 5.6.7.8
    port: 1080
  - name: "Invalid-Node"
    type: vmess
    # missing server & port
`

	nodes, err := ParseClashFromBytes([]byte(yamlContent))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(nodes) != 2 {
		t.Fatalf("expected 2 valid nodes, got %d", len(nodes))
	}

	if nodes[0].Name != "JP-Tokyo-01" || nodes[0].Server != "1.2.3.4" || nodes[0].Port != 8388 {
		t.Errorf("unexpected node 0: %+v", nodes[0])
	}
	if nodes[1].Name != "US-Silicon-02" || nodes[1].Type != "socks5" {
		t.Errorf("unexpected node 1: %+v", nodes[1])
	}
}

func TestParseClashWithProxyCapital(t *testing.T) {
	yamlContent := `
Proxy:
  - name: "SG-01"
    type: ss
    server: 9.9.9.9
    port: "8388"
`
	nodes, err := ParseClashFromBytes([]byte(yamlContent))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(nodes) != 1 || nodes[0].Name != "SG-01" || nodes[0].Port != 8388 {
		t.Fatalf("expected 1 node with port 8388, got %+v", nodes)
	}
}

func TestParseBase64Clash(t *testing.T) {
	rawYaml := `
proxies:
  - name: "Base64-HK"
    type: trojan
    server: 1.1.1.1
    port: 443
    password: "pwd"
`
	encoded := base64.StdEncoding.EncodeToString([]byte(rawYaml))
	nodes, err := ParseClashFromBytes([]byte(encoded))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(nodes) != 1 || nodes[0].Name != "Base64-HK" {
		t.Fatalf("expected 1 base64 clash node, got %+v", nodes)
	}
}

func TestParseBase64URIs(t *testing.T) {
	uriContent := `
trojan://pass123@1.2.3.4:443#Trojan-Node
vless://uuid-test@5.6.7.8:8443#VLESS-Node
`
	encoded := base64.StdEncoding.EncodeToString([]byte(uriContent))
	nodes, err := ParseClashFromBytes([]byte(encoded))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 URI nodes, got %d", len(nodes))
	}
	if nodes[0].Name != "Trojan-Node" || nodes[0].Type != "trojan" || nodes[0].Port != 443 {
		t.Errorf("unexpected node 0: %+v", nodes[0])
	}
	if nodes[1].Name != "VLESS-Node" || nodes[1].Type != "vless" || nodes[1].Port != 8443 {
		t.Errorf("unexpected node 1: %+v", nodes[1])
	}
}

func TestParseVMessURI(t *testing.T) {
	// 1. 包含 ps 别名的标准 VMess 节点
	vmessJSON1 := `{"v":"2","ps":"VMess-Node-01","add":"11.22.33.44","port":10086,"id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","aid":"0","net":"ws","type":"none","host":"","path":"/ray","tls":""}`
	b64VMess1 := base64.StdEncoding.EncodeToString([]byte(vmessJSON1))
	uri1 := "vmess://" + b64VMess1

	nodes, err := ParseClashFromBytes([]byte(uri1))
	if err != nil {
		t.Fatalf("failed to parse vmess: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	if nodes[0].Name != "VMess-Node-01" || nodes[0].Type != "vmess" || nodes[0].Server != "11.22.33.44" || nodes[0].Port != 10086 || nodes[0].Password != "a1b2c3d4-e5f6-7890-abcd-ef1234567890" {
		t.Errorf("unexpected vmess node parsed: %+v", nodes[0])
	}

	// 2. 缺少 ps 别名时自动触发回退命名机制 (vmess-<server>:<port>)
	vmessJSON2 := `{"v":"2","ps":"","add":"55.66.77.88","port":"20086","id":"uuid-fallback"}`
	b64VMess2 := base64.StdEncoding.EncodeToString([]byte(vmessJSON2))
	uri2 := "vmess://" + b64VMess2

	nodes2, err := ParseClashFromBytes([]byte(uri2))
	if err != nil {
		t.Fatalf("failed to parse fallback vmess: %v", err)
	}
	if len(nodes2) != 1 || nodes2[0].Name != "vmess-55.66.77.88:20086" {
		t.Errorf("unexpected fallback node: %+v", nodes2)
	}

	// 3. 非法或损坏的 VMess 格式拦截
	invalidCases := []string{
		"vmess://!!!invalid-base64",
		"vmess://" + base64.StdEncoding.EncodeToString([]byte(`{"v":"2","add":""}`)),           // 缺少地址
		"vmess://" + base64.StdEncoding.EncodeToString([]byte(`{"v":"2","add":"1.1.1.1","port":0}`)), // 非法端口
		"vmess://" + base64.StdEncoding.EncodeToString([]byte(`not-json`)),                      // 非法 JSON
	}
	for _, inv := range invalidCases {
		_, err := parseVMessURI(inv)
		if err == nil {
			t.Errorf("expected error for invalid vmess '%s', got nil", inv)
		}
	}
}

func TestParseShadowsocksURI(t *testing.T) {
	// 1. 标准 SIP002 格式: ss://[base64(method:password)]@server:port#NodeName
	authStandard := base64.StdEncoding.EncodeToString([]byte("aes-256-gcm:secret-pwd"))
	ssStandard := "ss://" + authStandard + "@123.123.123.123:8388#SS-Standard-Node"

	nodeStd, err := parseShadowsocksURI(ssStandard)
	if err != nil {
		t.Fatalf("parseShadowsocksURI standard failed: %v", err)
	}
	if nodeStd.Name != "SS-Standard-Node" || nodeStd.Server != "123.123.123.123" || nodeStd.Port != 8388 || nodeStd.Password != "secret-pwd" || nodeStd.Type != "ss" {
		t.Errorf("unexpected standard SS node: %+v", nodeStd)
	}

	// 2. URL 编码节点名称与携带 Query 查询参数
	ssWithQuery := "ss://" + authStandard + "@123.123.123.123:8388/?plugin=v2ray-plugin#%E6%97%A5%E6%9C%AC-01"
	nodeQuery, err := parseShadowsocksURI(ssWithQuery)
	if err != nil {
		t.Fatalf("parseShadowsocksURI with query failed: %v", err)
	}
	if nodeQuery.Name != "日本-01" || nodeQuery.Port != 8388 {
		t.Errorf("unexpected query SS node: %+v", nodeQuery)
	}

	// 3. 兼容传统旧版 Base64 格式: ss://[base64(method:password@server:port)]#NodeName
	legacyRaw := "chacha20-ietf-poly1305:mypassword@44.55.66.77:9000"
	legacyB64 := base64.StdEncoding.EncodeToString([]byte(legacyRaw))
	ssLegacy := "ss://" + legacyB64 + "#SS-Legacy-Node"

	nodeLegacy, err := parseShadowsocksURI(ssLegacy)
	if err != nil {
		t.Fatalf("parseShadowsocksURI legacy failed: %v", err)
	}
	if nodeLegacy.Name != "SS-Legacy-Node" || nodeLegacy.Server != "44.55.66.77" || nodeLegacy.Port != 9000 || nodeLegacy.Password != "mypassword" {
		t.Errorf("unexpected legacy SS node: %+v", nodeLegacy)
	}

	// 4. 无 #fragment 时的回退命名机制: ss-<host>:<port>
	ssNoName := "ss://" + authStandard + "@88.88.88.88:8388"
	nodeNoName, err := parseShadowsocksURI(ssNoName)
	if err != nil {
		t.Fatalf("parseShadowsocksURI without fragment failed: %v", err)
	}
	if nodeNoName.Name != "ss-88.88.88.88:8388" {
		t.Errorf("expected fallback name 'ss-88.88.88.88:8388', got '%s'", nodeNoName.Name)
	}

	// 5. 格式损毁的非法的 Shadowsocks URI
	invalidSS := []string{
		"ss://invalid-base64-without-at",
		"ss://" + base64.StdEncoding.EncodeToString([]byte("missing-at-host-port")),
		"ss://" + authStandard + "@invalid-host-port",
	}
	for _, inv := range invalidSS {
		_, err := parseShadowsocksURI(inv)
		if err == nil {
			t.Errorf("expected error for invalid ss '%s', got nil", inv)
		}
	}
}

func TestParseHysteria2AndTUIC(t *testing.T) {
	lines := `
hysteria2://mypassword@hy2.example.com:443#Hysteria2-Node
hy2://shortpwd@hy2short.example.com:8443#HY2-Short-Node
tuic://tuic-uuid:tuic-pwd@tuic.example.com:10443#TUIC-Node
`
	nodes, err := ParseClashFromBytes([]byte(lines))
	if err != nil {
		t.Fatalf("failed to parse Hysteria2 and TUIC: %v", err)
	}
	if len(nodes) != 3 {
		t.Fatalf("expected 3 nodes, got %d", len(nodes))
	}

	// 校验 hysteria2
	if nodes[0].Name != "Hysteria2-Node" || nodes[0].Type != "hysteria2" || nodes[0].Server != "hy2.example.com" || nodes[0].Port != 443 || nodes[0].Password != "mypassword" {
		t.Errorf("unexpected hysteria2 node: %+v", nodes[0])
	}

	// 校验 hy2 别名安全归一化为 hysteria2
	if nodes[1].Name != "HY2-Short-Node" || nodes[1].Type != "hysteria2" || nodes[1].Server != "hy2short.example.com" || nodes[1].Port != 8443 || nodes[1].Password != "shortpwd" {
		t.Errorf("unexpected hy2 normalized node: %+v", nodes[1])
	}

	// 校验 tuic
	if nodes[2].Name != "TUIC-Node" || nodes[2].Type != "tuic" || nodes[2].Server != "tuic.example.com" || nodes[2].Port != 10443 || nodes[2].Password != "tuic-pwd" {
		t.Errorf("unexpected tuic node: %+v", nodes[2])
	}
}

func TestParseSocksAndHTTP(t *testing.T) {
	lines := `
socks5://user:pass@1.1.1.1:1080#Socks5-Auth
socks://2.2.2.2:1080#Socks-Normalized
http://3.3.3.3:8080#HTTP-Proxy
https://secret@4.4.4.4:8443#HTTPS-Proxy
socks5://5.5.5.5:1080
`
	nodes, err := ParseClashFromBytes([]byte(lines))
	if err != nil {
		t.Fatalf("failed to parse socks and http: %v", err)
	}
	if len(nodes) != 5 {
		t.Fatalf("expected 5 nodes, got %d", len(nodes))
	}

	// socks5 带认证
	if nodes[0].Type != "socks5" || nodes[0].Password != "pass" {
		t.Errorf("unexpected socks5 node: %+v", nodes[0])
	}

	// socks 规范化为 socks5
	if nodes[1].Type != "socks5" || nodes[1].Name != "Socks-Normalized" {
		t.Errorf("unexpected socks normalized node: %+v", nodes[1])
	}

	// http 协议
	if nodes[2].Type != "http" || nodes[2].Port != 8080 {
		t.Errorf("unexpected http node: %+v", nodes[2])
	}

	// https 协议
	if nodes[3].Type != "https" || nodes[3].Password != "secret" {
		t.Errorf("unexpected https node: %+v", nodes[3])
	}

	// socks5 无 fragment（触发回退命名）
	if nodes[4].Name != "socks5-5.5.5.5:1080" {
		t.Errorf("expected fallback name 'socks5-5.5.5.5:1080', got '%s'", nodes[4].Name)
	}
}

func TestParseWithBOM(t *testing.T) {
	bom := "\xef\xbb\xbf"

	// 1. 包含 UTF-8 BOM 的 YAML 文本
	yamlContent := bom + `
proxies:
  - name: "BOM-YAML-Node"
    type: trojan
    server: 1.2.3.4
    port: 443
    password: "pwd"
`
	nodes, err := ParseClashFromBytes([]byte(yamlContent))
	if err != nil {
		t.Fatalf("failed to parse YAML with BOM: %v", err)
	}
	if len(nodes) != 1 || nodes[0].Name != "BOM-YAML-Node" {
		t.Fatalf("expected 1 node from BOM YAML, got %+v", nodes)
	}

	// 2. 包含 UTF-8 BOM 的 URI 列表文本
	uriContent := bom + "trojan://pwd@5.6.7.8:443#BOM-URI-Node\n"
	nodesURI, err := ParseClashFromBytes([]byte(uriContent))
	if err != nil {
		t.Fatalf("failed to parse URI list with BOM: %v", err)
	}
	if len(nodesURI) != 1 || nodesURI[0].Name != "BOM-URI-Node" {
		t.Fatalf("expected 1 node from BOM URI, got %+v", nodesURI)
	}
}

func TestParseCorruptContent(t *testing.T) {
	// 1. 完全为空或全空白字符的内容
	emptyCases := [][]byte{
		{},
		[]byte("   "),
		[]byte("\r\n\t\n"),
		[]byte("\xef\xbb\xbf   \n"),
	}
	for _, c := range emptyCases {
		_, err := ParseClashFromBytes(c)
		if err == nil {
			t.Errorf("expected error for empty/blank content, got nil")
		}
	}

	// 2. 无法识别的损毁混乱内容
	corruptCases := [][]byte{
		[]byte("!@#$%^&*()_+{}[]:;\"'<>?,./"),
		[]byte("some random text without any proxy definitions"),
	}
	for _, c := range corruptCases {
		_, err := ParseClashFromBytes(c)
		if err == nil {
			t.Errorf("expected error for corrupt content '%s', got nil", string(c))
		}
	}

	// 3. 混合内容：注释、空行、非法协议行与有效节点链接混合
	mixedContent := `
# 机场公告注释行
// 另一行注释

invalid://unsupported-protocol@1.2.3.4:443#Bad
trojan://valid-pass@1.2.3.4:443#Valid-Trojan

# 尾部注释行
`
	mixedNodes, err := ParseClashFromBytes([]byte(mixedContent))
	if err != nil {
		t.Fatalf("unexpected error on mixed content: %v", err)
	}
	if len(mixedNodes) != 1 || mixedNodes[0].Name != "Valid-Trojan" {
		t.Fatalf("expected 1 valid node extracted from mixed content, got %+v", mixedNodes)
	}
}

func TestDecodeBase64Safe(t *testing.T) {
	testRaw := "Hello NodePilot Benchmark!"

	// 标准 Base64
	std := base64.StdEncoding.EncodeToString([]byte(testRaw))
	if dec, err := decodeBase64Safe(std); err != nil || string(dec) != testRaw {
		t.Errorf("decodeBase64Safe failed on std base64: %v, got %s", err, string(dec))
	}

	// 去除填充 '='
	unpadded := strings.TrimRight(std, "=")
	if dec, err := decodeBase64Safe(unpadded); err != nil || string(dec) != testRaw {
		t.Errorf("decodeBase64Safe failed on unpadded base64: %v, got %s", err, string(dec))
	}

	// 包含多余换行符与空格
	withNewlines := "\n  " + std[:10] + "\r\n " + std[10:] + "\n"
	if dec, err := decodeBase64Safe(withNewlines); err != nil || string(dec) != testRaw {
		t.Errorf("decodeBase64Safe failed on base64 with whitespaces: %v, got %s", err, string(dec))
	}

	// URL-safe Base64
	urlSafeRaw := "Subjects?query=1&flag=2+3/4"
	urlSafeEnc := base64.URLEncoding.EncodeToString([]byte(urlSafeRaw))
	if dec, err := decodeBase64Safe(urlSafeEnc); err != nil || string(dec) != urlSafeRaw {
		t.Errorf("decodeBase64Safe failed on URL safe base64: %v, got %s", err, string(dec))
	}
}
