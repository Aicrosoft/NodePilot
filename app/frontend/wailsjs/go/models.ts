export namespace model {
	
	export class StreamMetrics {
	    ttft: number;
	    tps: number;
	    total_tokens: number;
	    jitter_variance_ms: number;
	    max_chunk_gap: number;
	    proxy_buffer_detected: boolean;
	    ingress_speed_byte_sec: number;
	
	    static createFrom(source: any = {}) {
	        return new StreamMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ttft = source["ttft"];
	        this.tps = source["tps"];
	        this.total_tokens = source["total_tokens"];
	        this.jitter_variance_ms = source["jitter_variance_ms"];
	        this.max_chunk_gap = source["max_chunk_gap"];
	        this.proxy_buffer_detected = source["proxy_buffer_detected"];
	        this.ingress_speed_byte_sec = source["ingress_speed_byte_sec"];
	    }
	}
	export class NetworkMetrics {
	    dns_lookup: number;
	    tcp_connect: number;
	    tls_handshake: number;
	    ttfb: number;
	    total_time: number;
	
	    static createFrom(source: any = {}) {
	        return new NetworkMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dns_lookup = source["dns_lookup"];
	        this.tcp_connect = source["tcp_connect"];
	        this.tls_handshake = source["tls_handshake"];
	        this.ttfb = source["ttfb"];
	        this.total_time = source["total_time"];
	    }
	}
	export class BenchmarkResult {
	    airport_name?: string;
	    node_name: string;
	    service_name: string;
	    ai_offer?: string;
	    status: string;
	    status_code: number;
	    ping_ms: number;
	    ping_status: string;
	    network: NetworkMetrics;
	    stream: StreamMetrics;
	    score: number;
	    rank?: number;
	    error_msg?: string;
	    // Go type: time
	    tested_at: any;
	
	    static createFrom(source: any = {}) {
	        return new BenchmarkResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.airport_name = source["airport_name"];
	        this.node_name = source["node_name"];
	        this.service_name = source["service_name"];
	        this.ai_offer = source["ai_offer"];
	        this.status = source["status"];
	        this.status_code = source["status_code"];
	        this.ping_ms = source["ping_ms"];
	        this.ping_status = source["ping_status"];
	        this.network = this.convertValues(source["network"], NetworkMetrics);
	        this.stream = this.convertValues(source["stream"], StreamMetrics);
	        this.score = source["score"];
	        this.rank = source["rank"];
	        this.error_msg = source["error_msg"];
	        this.tested_at = this.convertValues(source["tested_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Node {
	    airport_name?: string;
	    name: string;
	    type: string;
	    server: string;
	    port: number;
	    password?: string;
	    raw?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Node(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.airport_name = source["airport_name"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.server = source["server"];
	        this.port = source["port"];
	        this.password = source["password"];
	        this.raw = source["raw"];
	    }
	}

}

export namespace storage {
	
	export class HistoryRecord {
	    id?: number;
	    batch_id: string;
	    airport_name: string;
	    node_name: string;
	    node_type: string;
	    server: string;
	    port: number;
	    service_name: string;
	    ai_offer: string;
	    status: string;
	    ping_ms: number;
	    ping_status: string;
	    score: number;
	    ttfb_ms: number;
	    ttft_ms: number;
	    tps: number;
	    jitter_ms: number;
	    bandwidth_bps: number;
	    proxy_buffer_detected: boolean;
	    rank: number;
	    tested_at: string;
	    tested_time_display: string;
	    batch_time: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.batch_id = source["batch_id"];
	        this.airport_name = source["airport_name"];
	        this.node_name = source["node_name"];
	        this.node_type = source["node_type"];
	        this.server = source["server"];
	        this.port = source["port"];
	        this.service_name = source["service_name"];
	        this.ai_offer = source["ai_offer"];
	        this.status = source["status"];
	        this.ping_ms = source["ping_ms"];
	        this.ping_status = source["ping_status"];
	        this.score = source["score"];
	        this.ttfb_ms = source["ttfb_ms"];
	        this.ttft_ms = source["ttft_ms"];
	        this.tps = source["tps"];
	        this.jitter_ms = source["jitter_ms"];
	        this.bandwidth_bps = source["bandwidth_bps"];
	        this.proxy_buffer_detected = source["proxy_buffer_detected"];
	        this.rank = source["rank"];
	        this.tested_at = source["tested_at"];
	        this.tested_time_display = source["tested_time_display"];
	        this.batch_time = source["batch_time"];
	    }
	}
	export class HistoryStats {
	    total_records: number;
	    first_tested: string;
	    last_tested: string;
	    airport_count: number;
	    node_count: number;
	
	    static createFrom(source: any = {}) {
	        return new HistoryStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_records = source["total_records"];
	        this.first_tested = source["first_tested"];
	        this.last_tested = source["last_tested"];
	        this.airport_count = source["airport_count"];
	        this.node_count = source["node_count"];
	    }
	}

}

