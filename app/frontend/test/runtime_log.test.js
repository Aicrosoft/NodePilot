import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml, highlightLogLine } from "../src/js/runtime_log.js";
import zh from "../src/js/i18n/locales/zh.js";
import en from "../src/js/i18n/locales/en.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Runtime Log - escapeHtml: XSS sanitization and boundary handling", () => {
    assert.strictEqual(escapeHtml(""), "");
    assert.strictEqual(escapeHtml(null), "");
    assert.strictEqual(escapeHtml(undefined), "");

    const input = `<script>alert("xss" & 'test')</script>`;
    const output = escapeHtml(input);
    assert.strictEqual(output, `&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;test&#039;)&lt;/script&gt;`);
    assert.strictEqual(output.includes("<"), false);
    assert.strictEqual(output.includes(">"), false);
});

test("Runtime Log - highlightLogLine: Syntax highlighting classification", () => {
    // 1. ERROR -> Red (#f87171)
    const errLine = "[2026-11-19 09:52:22.380] [ERROR] [DIALER] Dial FAILED via proxy";
    const errHtml = highlightLogLine(errLine);
    assert.ok(errHtml.includes("#f87171"), "ERROR line must contain red color style");
    assert.ok(errHtml.includes("Dial FAILED"), "Original text preserved");

    // 2. WARN -> Amber (#fbbf24)
    const warnLine = "[2026-11-19 09:52:21.881] [WARN] [PING] Pre-ping failed for node";
    const warnHtml = highlightLogLine(warnLine);
    assert.ok(warnHtml.includes("#fbbf24"), "WARN line must contain amber color style");

    // 3. INFO (Success) -> Emerald Green (#4ade80)
    const successLine = "[2026-11-19 09:52:22.879] [INFO] [DB] Successfully written 90 benchmark history records";
    const successHtml = highlightLogLine(successLine);
    assert.ok(successHtml.includes("#4ade80"), "INFO success line must contain green color style");

    // 4. INFO (General) -> Slate Gray (#94a3b8)
    const infoLine = "[2026-11-19 09:52:20.000] [INFO] [ENGINE] Starting batch test";
    const infoHtml = highlightLogLine(infoLine);
    assert.ok(infoHtml.includes("#94a3b8"), "General INFO line must contain slate gray style");

    // 5. DEBUG -> Purple (#a855f7)
    const debugLine = "[2026-11-19 09:52:20.010] [DEBUG] [PROBE] Initializing handshake";
    const debugHtml = highlightLogLine(debugLine);
    assert.ok(debugHtml.includes("#a855f7"), "DEBUG line must contain purple color style");

    // 6. Non-tagged line -> standard span
    const plainLine = "Raw output without log tag";
    const plainHtml = highlightLogLine(plainLine);
    assert.strictEqual(plainHtml, "<span>Raw output without log tag</span>");
});

test("Runtime Log - Fragment Contract: Auto-refresh & Auto-scroll Controls in DOM", () => {
    const fragmentPath = path.resolve(__dirname, "../src/fragments/drawer_runtime_log.html");
    const content = fs.readFileSync(fragmentPath, "utf-8");

    // Verify auto-refresh checkbox
    assert.ok(content.includes('id="chk-auto-refresh-log"'), "Fragment must have #chk-auto-refresh-log");
    assert.ok(content.includes('checked'), "#chk-auto-refresh-log should be checked by default");

    // Verify auto-scroll checkbox
    assert.ok(content.includes('id="chk-auto-scroll-log"'), "Fragment must have #chk-auto-scroll-log");

    // Verify close button class for global ESC key handler
    assert.ok(content.includes('class="btn-icon btn-close"'), "Close button must include .btn-close for ESC binding");

    // Verify refresh button
    assert.ok(content.includes('id="btn-refresh-runtime-log"'), "Fragment must retain #btn-refresh-runtime-log");
});

test("Runtime Log - i18n Dictionary: auto_refresh key presence", () => {
    assert.ok(zh.runtime_log.auto_refresh, "zh.runtime_log.auto_refresh must exist");
    assert.ok(zh.runtime_log.auto_refresh.includes("自动刷新"), "zh text must describe auto-refresh");

    assert.ok(en.runtime_log.auto_refresh, "en.runtime_log.auto_refresh must exist");
    assert.ok(en.runtime_log.auto_refresh.includes("Auto-refresh"), "en text must describe auto-refresh");
});
