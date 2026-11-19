import test from "node:test";
import assert from "node:assert/strict";
import { openExternalURL } from "../src/js/sidebar.js";
import { t } from "../src/js/i18n/i18n.js";
import zh from "../src/js/i18n/locales/zh.js";
import en from "../src/js/i18n/locales/en.js";

test("Sidebar - openExternalURL: Calls Wails window.runtime.BrowserOpenURL when present", () => {
    let openedUrl = null;
    globalThis.window = {
        runtime: {
            BrowserOpenURL: (url) => {
                openedUrl = url;
            }
        }
    };

    const target = "https://github.com/Aicrosoft/NodePilot";
    openExternalURL(target);
    assert.strictEqual(openedUrl, target);

    // Clean up
    delete globalThis.window;
});

test("Sidebar - openExternalURL: Falls back to window.open in browser environment", () => {
    let openedUrl = null;
    let targetParam = null;
    let featuresParam = null;

    globalThis.window = {
        open: (url, target, features) => {
            openedUrl = url;
            targetParam = target;
            featuresParam = features;
            return {};
        }
    };

    const target = "https://github.com/Aicrosoft/NodePilot";
    openExternalURL(target);
    assert.strictEqual(openedUrl, target);
    assert.strictEqual(targetParam, "_blank");
    assert.strictEqual(featuresParam, "noopener,noreferrer");

    // Clean up
    delete globalThis.window;
});

test("Sidebar - openExternalURL: Empty or null URL safety guard", () => {
    let called = false;
    globalThis.window = {
        open: () => {
            called = true;
        }
    };

    openExternalURL(null);
    openExternalURL("");
    openExternalURL(undefined);
    assert.strictEqual(called, false);

    delete globalThis.window;
});

test("Sidebar - i18n Dictionary: sidebar.github_repo & sidebar.issue_feedback presence and accuracy", () => {
    assert.ok(zh.sidebar.github_repo, "zh.sidebar.github_repo must exist");
    assert.ok(zh.sidebar.github_repo.includes("GitHub"), "zh github_repo should mention GitHub");
    assert.ok(en.sidebar.github_repo, "en.sidebar.github_repo must exist");
    assert.ok(en.sidebar.github_repo.includes("GitHub"), "en github_repo should mention GitHub");

    assert.ok(zh.sidebar.issue_feedback, "zh.sidebar.issue_feedback must exist");
    assert.ok(zh.sidebar.issue_feedback.includes("GitHub"), "zh string should mention GitHub");
    assert.ok(en.sidebar.issue_feedback, "en.sidebar.issue_feedback must exist");
    assert.ok(en.sidebar.issue_feedback.includes("GitHub"), "en string should mention GitHub");

    // Translation function lookup
    const translated = t("sidebar.github_repo");
    assert.ok(translated && translated !== "sidebar.github_repo");
});

test("Sidebar - DOM & CSS Layout: GitHub button relocated to subtitle row and collapsed rules", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const htmlPath = path.resolve(__dirname, "../src/index.html");
    const cssPath = path.resolve(__dirname, "../src/css/sidebar.css");

    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // 1. Verify index.html: title-row does NOT contain btn-sidebar-issue or btn-sidebar-github
    const titleRowMatch = htmlContent.match(/<div class="sidebar-brand-title-row">([\s\S]*?)<\/div>/);
    assert.ok(titleRowMatch, "sidebar-brand-title-row must exist in index.html");
    assert.ok(!titleRowMatch[1].includes("btn-sidebar-issue") && !titleRowMatch[1].includes("btn-sidebar-github"), "btn-sidebar-github must be moved OUT of title-row");
    assert.ok(titleRowMatch[1].includes("sidebar-brand-name"), "title-row must retain sidebar-brand-name");

    // 2. Verify index.html: sub-row contains both sidebar-brand-sub and btn-sidebar-github
    const subRowMatch = htmlContent.match(/<div class="sidebar-brand-sub-row">([\s\S]*?)<\/div>/);
    assert.ok(subRowMatch, "sidebar-brand-sub-row must exist in index.html");
    assert.ok(subRowMatch[1].includes("sidebar-brand-sub"), "sub-row must contain sidebar-brand-sub");
    assert.ok(subRowMatch[1].includes("btn-sidebar-github") || subRowMatch[1].includes("btn-sidebar-issue"), "sub-row must contain btn-sidebar-github");

    // 3. Verify sidebar.css: flex layout and space-between in .sidebar-brand-sub-row
    assert.ok(cssContent.includes(".sidebar-brand-sub-row"), "sidebar.css must style .sidebar-brand-sub-row");
    assert.ok(cssContent.includes("justify-content: space-between"), "sub-row must use justify-content: space-between");

    // 4. Verify sidebar.css: collapsed sidebar hides .sidebar-brand-sub-row
    assert.ok(
        cssContent.includes(".app-sidebar.collapsed .sidebar-brand-sub-row"),
        "collapsed mode must hide .sidebar-brand-sub-row"
    );
});
