import test from "node:test";
import assert from "node:assert/strict";
import { validateSubscriptionURL, analyzeSubscriptionError } from "../src/js/diag.js";

test("Diag - validateSubscriptionURL: Empty & Whitespace Validation", () => {
    // Null value
    const resNull = validateSubscriptionURL(null);
    assert.ok(resNull && typeof resNull === "string");
    assert.match(resNull, /URL/i);

    const resUndefined = validateSubscriptionURL(undefined);
    assert.ok(resUndefined && typeof resUndefined === "string");

    const resEmpty = validateSubscriptionURL("");
    assert.ok(resEmpty && typeof resEmpty === "string");

    // Whitespace only
    const resWhitespace = validateSubscriptionURL("   \t  \n  ");
    assert.ok(resWhitespace && typeof resWhitespace === "string");
});

test("Diag - validateSubscriptionURL: Protocol Check (http/https)", () => {
    // Missing protocol prefix
    const resNoProto = validateSubscriptionURL("example.com/api/v1/sub");
    assert.ok(resNoProto);
    assert.match(resNoProto, /http:\/\/|https:\/\//);

    // Unsupported protocol prefix
    const resFtp = validateSubscriptionURL("ftp://sub.example.com/config");
    assert.ok(resFtp);
    assert.match(resFtp, /http:\/\/|https:\/\//);

    const resClash = validateSubscriptionURL("clash://install-config?url=https%3A%2F%2Fsub.com");
    assert.ok(resClash);
    assert.match(resClash, /http:\/\/|https:\/\//);
});

test("Diag - validateSubscriptionURL: Malformed & Invalid Domains", () => {
    // Protocol only without host
    const resOnlyHttp = validateSubscriptionURL("http://");
    assert.ok(resOnlyHttp);

    // Malformed domain with illegal characters
    const resInvalid = validateSubscriptionURL("https://foo bar.com/sub?token=123");
    assert.ok(resInvalid);

    const resBadHost = validateSubscriptionURL("https://[invalid-ipv6/sub");
    assert.ok(resBadHost);
});

test("Diag - validateSubscriptionURL: Valid Subscription URLs", () => {
    // Standard HTTPS subscription
    assert.strictEqual(
        validateSubscriptionURL("https://api.airport.com/v1/client/subscribe?token=abc123xyz"),
        null
    );

    // Leading and trailing whitespaces (trimmed automatically)
    assert.strictEqual(
        validateSubscriptionURL("   https://sub.domain.org/clash.yaml   "),
        null
    );

    // Local / Intranet HTTP subscription
    assert.strictEqual(
        validateSubscriptionURL("http://127.0.0.1:8080/my-nodes.txt"),
        null
    );

    // URL with port and hash fragment
    assert.strictEqual(
        validateSubscriptionURL("https://sub.provider.net:8443/download/yaml#MyAirport"),
        null
    );
});

test("Diag - analyzeSubscriptionError: 403 Forbidden Detection", () => {
    const errorMessages = [
        "HTTP 403 Forbidden: Request failed",
        "fetch failed: status code 403",
        "Error: forbidden access by remote server"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /403|Forbidden/i);
        assert.match(diag.advice, /token|expire|403|expired|credential/i);
    }
});

test("Diag - analyzeSubscriptionError: 401 Unauthorized Detection", () => {
    const errorMessages = [
        "HTTP 401 Unauthorized",
        "failed with 401: bad credentials",
        "Unauthorized request token expired"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /401|Unauthorized/i);
        assert.match(diag.advice, /token|credential|expired/i);
    }
});

test("Diag - analyzeSubscriptionError: 404 Not Found Detection", () => {
    const errorMessages = [
        "HTTP 404 Not Found",
        "Request returned status code 404",
        "resource not found"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /404|Not Found/i);
        assert.match(diag.advice, /exist|path|not found/i);
    }
});

test("Diag - analyzeSubscriptionError: 5xx Server Error Detection (500, 502, 503, 504)", () => {
    const statuses = ["500 Internal Error", "502 Bad Gateway", "503 Service Unavailable", "504 Gateway Timeout"];

    for (const msg of statuses) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /5xx|Server Error/i);
        assert.match(diag.advice, /down|maintenance|server/i);
    }
});

test("Diag - analyzeSubscriptionError: Timeout & Deadline Exceeded Detection", () => {
    const errorMessages = [
        "Network connection timeout after 15000ms",
        "context deadline exceeded while dialing",
        "ETIMEDOUT: Connection timed out"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /Timeout/i);
        assert.match(diag.advice, /network|connect|proxy|DNS/i);
    }
});

test("Diag - analyzeSubscriptionError: DNS Failure Detection", () => {
    const errorMessages = [
        "dial tcp: lookup sub.nonexistent-domain.xyz: no such host",
        "getaddrinfo ENOTFOUND lookup failed"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /DNS|Name Not Resolved/i);
        assert.match(diag.advice, /domain|DNS/i);
    }
});

test("Diag - analyzeSubscriptionError: Empty Proxies / Unsupported Content", () => {
    const errorMessages = [
        "Failed to parse any valid proxy nodes",
        "Downloaded successfully but contains 0 nodes",
        "0 proxies parsed",
        "unsupported uri protocol: text/html",
        "empty response payload received"
    ];

    for (const msg of errorMessages) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.match(diag.title, /Empty|No Proxies/i);
        assert.match(diag.advice, /Clash|webpage|proxies|valid/i);
    }
});

test("Diag - analyzeSubscriptionError: Unknown Fallback & Default Advice", () => {
    const unknowns = [
        "some arbitrary undefined error",
        "",
        null,
        undefined
    ];

    for (const msg of unknowns) {
        const diag = analyzeSubscriptionError("https://sub.example.com", msg);
        assert.ok(diag.title && typeof diag.title === "string");
        assert.ok(diag.advice && typeof diag.advice === "string");
        assert.match(diag.title, /Error|Exception/i);
    }
});
