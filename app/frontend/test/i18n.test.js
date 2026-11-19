import test from "node:test";
import assert from "node:assert/strict";
import {
    getNestedValue,
    t,
    getCurrentLanguage,
    getCurrentLanguageSetting,
    detectSystemLanguage,
    setAppVersion
} from "../src/js/i18n/i18n.js";

test("i18n - getNestedValue: Deep Path Lookup & String Extraction", () => {
    const dictionary = {
        app: {
            title: "NodePilot",
            header: {
                subtitle: "Next-gen AI Benchmark",
                version: "1.0.0"
            }
        },
        simple: "Top Level Value",
        invalid_leaf: {
            count: 42,
            list: ["item1", "item2"],
            obj: {}
        }
    };

    // 1. Single and multi-level nested lookup
    assert.strictEqual(getNestedValue(dictionary, "simple"), "Top Level Value");
    assert.strictEqual(getNestedValue(dictionary, "app.title"), "NodePilot");
    assert.strictEqual(getNestedValue(dictionary, "app.header.subtitle"), "Next-gen AI Benchmark");
    assert.strictEqual(getNestedValue(dictionary, "app.header.version"), "1.0.0");

    // 2. Non-existent key returns null
    assert.strictEqual(getNestedValue(dictionary, "app.nonexistent"), null);
    assert.strictEqual(getNestedValue(dictionary, "app.header.deep.missing"), null);
    assert.strictEqual(getNestedValue(dictionary, "missing_root"), null);

    // 3. Non-string leaf node (number, array, object) returns null
    assert.strictEqual(getNestedValue(dictionary, "invalid_leaf.count"), null);
    assert.strictEqual(getNestedValue(dictionary, "invalid_leaf.list"), null);
    assert.strictEqual(getNestedValue(dictionary, "invalid_leaf.obj"), null);
    assert.strictEqual(getNestedValue(dictionary, "app.header"), null);
});

test("i18n - getNestedValue: Boundary & Malformed Inputs", () => {
    // Null, undefined or empty path guard
    assert.strictEqual(getNestedValue(null, "app.title"), null);
    assert.strictEqual(getNestedValue(undefined, "app.title"), null);
    assert.strictEqual(getNestedValue({}, "app.title"), null);
    assert.strictEqual(getNestedValue({ app: "test" }, ""), null);
    assert.strictEqual(getNestedValue({ app: "test" }, null), null);
    assert.strictEqual(getNestedValue({ app: "test" }, undefined), null);

    // Primitive types passed as dictionary guard
    assert.strictEqual(getNestedValue("string", "length"), null);
    assert.strictEqual(getNestedValue(12345, "toFixed"), null);
});

test("i18n - t: Dynamic Parameter Interpolation ({name}, {count})", () => {
    // Multi-parameter interpolation
    const interpolated = t("sidebar.selected_airports", { count: 3, total: 10 });
    assert.ok(interpolated.includes("3"));
    assert.ok(interpolated.includes("10"));
    assert.strictEqual(interpolated.includes("{count}"), false, "Placeholder {count} must be replaced");
    assert.strictEqual(interpolated.includes("{total}"), false, "Placeholder {total} must be replaced");

    // Parameter interpolation with {name}
    const nameInterpolated = t("airports.toast_deleted", { name: "Fast-BGP-Airport" });
    assert.ok(nameInterpolated.includes("Fast-BGP-Airport"));
    assert.strictEqual(nameInterpolated.includes("{name}"), false);

    // Zero value interpolation
    const zeroInterpolated = t("sidebar.selected_airports", { count: 0, total: 0 });
    assert.ok(zeroInterpolated.includes("0 / 0"));
});

test("i18n - t: Missing Key Fallback Mechanism", () => {
    const missingKey = "this.key.does.not.exist.in.any.dictionary";

    // 1. Explicit fallback returned when key is missing
    const customFallback = t(missingKey, {}, "Default Fallback Text");
    assert.strictEqual(customFallback, "Default Fallback Text");

    // 2. Safe fallback to key itself when no fallback is provided
    const rawKeyFallback = t(missingKey);
    assert.strictEqual(rawKeyFallback, missingKey);

    const emptyFallback = t(missingKey, {}, "");
    assert.strictEqual(emptyFallback, missingKey);
});

test("i18n - Environment & Language State Diagnostics", () => {
    // Default language setting is "auto"
    assert.strictEqual(getCurrentLanguageSetting(), "auto");

    // Effective language must be either "zh" or "en"
    const effLang = getCurrentLanguage();
    assert.ok(effLang === "zh" || effLang === "en");

    // System language detection returns valid code
    const detected = detectSystemLanguage();
    assert.ok(detected === "zh" || detected === "en");
});

test("i18n - setAppVersion updates dictionary version dynamically", () => {
    // Initial static placeholder before dynamic backend injection
    assert.strictEqual(t("app.version"), "--");

    setAppVersion("0.1.999901");
    assert.strictEqual(t("app.version"), "v0.1.999901");

    setAppVersion("v0.2.0");
    assert.strictEqual(t("app.version"), "v0.2.0");
});
