import test from "node:test";
import assert from "node:assert/strict";
import {
    createBackupPayload,
    validateBackupPayload,
    mergeAirports
} from "../src/js/airport_backup.js";

test("Airport Backup - Validation (Empty, Corrupt & Invalid Structures)", () => {
    // 1. Empty content guard
    assert.deepStrictEqual(validateBackupPayload(""), { valid: false, error: "Empty backup content" });
    assert.deepStrictEqual(validateBackupPayload("   \n\t  "), { valid: false, error: "Empty backup content" });
    assert.deepStrictEqual(validateBackupPayload(null), { valid: false, error: "Empty backup content" });
    assert.deepStrictEqual(validateBackupPayload(undefined), { valid: false, error: "Empty backup content" });

    // 2. Corrupted JSON format
    const malformedResult = validateBackupPayload("{ invalid-json: true, ");
    assert.strictEqual(malformedResult.valid, false);
    assert.match(malformedResult.error, /Invalid JSON/);

    // 3. Missing airports array
    const missingAirports = JSON.stringify({
        version: "1.0",
        app: "NodePilot",
        exportTime: "2026-11-18 12:00:00"
    });
    const missingResult = validateBackupPayload(missingAirports);
    assert.strictEqual(missingResult.valid, false);
    assert.match(missingResult.error, /Missing airports/);

    // 4. airports field is not an array
    const stringAirports = JSON.stringify({
        version: "1.0",
        airports: "invalid-string"
    });
    const stringResult = validateBackupPayload(stringAirports);
    assert.strictEqual(stringResult.valid, false);
    assert.match(stringResult.error, /Missing airports/);

    // 5. Empty airports array
    const emptyList = JSON.stringify({
        version: "1.0",
        airports: []
    });
    const emptyResult = validateBackupPayload(emptyList);
    assert.strictEqual(emptyResult.valid, false);
    assert.match(emptyResult.error, /empty airports list/);
});

test("Airport Backup - Validation (Valid Standard & Pure Array Payloads)", () => {
    // 1. Standard backup payload
    const standardJSON = JSON.stringify({
        version: "1.0",
        app: "NodePilot",
        exportTime: "2026-11-18 12:00:00",
        totalAirports: 2,
        totalNodes: 3,
        airports: [
            { id: "ap-1", name: "Airport-1", nodes: [{ name: "n1" }] },
            { id: "ap-2", name: "Airport-2", nodes: [{ name: "n2" }, { name: "n3" }] }
        ]
    });
    const stdResult = validateBackupPayload(standardJSON);
    assert.strictEqual(stdResult.valid, true);
    assert.strictEqual(stdResult.version, "1.0");
    assert.strictEqual(stdResult.exportTime, "2026-11-18 12:00:00");
    assert.strictEqual(stdResult.totalAirports, 2);
    assert.strictEqual(stdResult.airports.length, 2);

    // 2. Pure array format
    const arrayJSON = JSON.stringify([
        { id: "ap-arr-1", name: "Array-Airport", nodes: [] }
    ]);
    const arrResult = validateBackupPayload(arrayJSON);
    assert.strictEqual(arrResult.valid, true);
    assert.strictEqual(arrResult.totalAirports, 1);
    assert.strictEqual(arrResult.airports[0].name, "Array-Airport");
});

test("Airport Backup - createBackupPayload Structure & Node Counting", () => {
    const inputAirports = [
        {
            id: "ap-101",
            name: "Cloud Airport",
            type: "url",
            url: "https://example.com/sub",
            totalNodeCount: 2,
            nodeCount: 1,
            rawNodes: [
                { name: "Node-1", server: "s1.com", port: 443 },
                { name: "Node-2", server: "s2.com", port: 443 }
            ],
            nodes: [
                { name: "Node-1", server: "s1.com", port: 443 }
            ]
        },
        {
            id: "ap-102",
            name: "Local Backup Airport",
            type: "file",
            filePath: "/configs/airport2.yaml",
            nodes: [
                { name: "Node-3", server: "s3.com", port: 443 }
            ]
        }
    ];

    const payload = createBackupPayload(inputAirports);
    assert.strictEqual(payload.version, "1.0");
    assert.strictEqual(payload.app, "NodePilot");
    assert.strictEqual(payload.totalAirports, 2);
    assert.strictEqual(payload.totalNodes, 3); // 2 from ap-101 rawNodes, 1 from ap-102 nodes
    assert.ok(payload.exportTime);
    assert.strictEqual(payload.airports.length, 2);

    // Validate normalized attributes
    const firstAp = payload.airports[0];
    assert.strictEqual(firstAp.id, "ap-101");
    assert.strictEqual(firstAp.name, "Cloud Airport");
    assert.strictEqual(firstAp.type, "url");
    assert.strictEqual(firstAp.url, "https://example.com/sub");
    assert.strictEqual(firstAp.totalNodeCount, 2);
    assert.strictEqual(firstAp.nodeCount, 1);
});

test("Airport Backup - Same-Name Airport Merge Strategy", () => {
    // Existing airport configs (with stable unique IDs)
    const currentAirports = [
        {
            id: "stable-id-airport-a",
            name: "Fast-Airport-A",
            type: "url",
            url: "https://old.url.com",
            filterRules: { include: "HK", exclude: "" },
            nodes: [{ name: "Old-HK-1" }],
            updatedAt: "2026-11-01 10:00"
        },
        {
            id: "stable-id-airport-b",
            name: "Stable-Airport-B",
            type: "file",
            filePath: "/configs/b.yaml",
            filterRules: null,
            nodes: [{ name: "Old-JP-1" }],
            updatedAt: "2026-11-01 10:00"
        }
    ];

    // Imported backup payload:
    // 1. Same-name airport "Fast-Airport-A"
    // 2. New airport "New-Airport-C"
    const importedAirports = [
        {
            id: "external-temp-id-999",
            name: "Fast-Airport-A", // Same name
            type: "url",
            url: "https://new.url.com/updated",
            filterRules: { include: "HK|Hong Kong", exclude: "0.1x" },
            nodes: [{ name: "New-HK-1" }, { name: "New-HK-2" }],
            updatedAt: "2026-11-18 12:00"
        },
        {
            id: "brand-new-id-c",
            name: "New-Airport-C", // Brand new
            type: "url",
            url: "https://c.url.com",
            nodes: [{ name: "US-Node-1" }],
            updatedAt: "2026-11-18 12:00"
        }
    ];

    const merged = mergeAirports(currentAirports, importedAirports);

    // After merge should contain 3 airports
    assert.strictEqual(merged.length, 3);

    // 1. Same-name airport A: inherits stable ID, updates nodes and URL
    const mergedA = merged.find(a => a.name === "Fast-Airport-A");
    assert.ok(mergedA);
    assert.strictEqual(mergedA.id, "stable-id-airport-a", "Same-name airport must preserve stable ID");
    assert.strictEqual(mergedA.url, "https://new.url.com/updated");
    assert.strictEqual(mergedA.nodes.length, 2);
    assert.deepStrictEqual(mergedA.filterRules, { include: "HK|Hong Kong", exclude: "0.1x" });

    // 2. Existing untouched airport B remains intact
    const mergedB = merged.find(a => a.name === "Stable-Airport-B");
    assert.ok(mergedB);
    assert.strictEqual(mergedB.id, "stable-id-airport-b");
    assert.strictEqual(mergedB.nodes.length, 1);

    // 3. New airport C appended
    const mergedC = merged.find(a => a.name === "New-Airport-C");
    assert.ok(mergedC);
    assert.strictEqual(mergedC.id, "brand-new-id-c");
    assert.strictEqual(mergedC.nodes.length, 1);
});

test("Airport Backup - Merge Empty Edge Cases", () => {
    const list = [{ id: "1", name: "A", nodes: [] }];

    // Empty current list
    assert.deepStrictEqual(mergeAirports([], list), list);

    // Empty imported list
    assert.deepStrictEqual(mergeAirports(list, []), list);

    // Both empty
    assert.deepStrictEqual(mergeAirports([], []), []);
});
