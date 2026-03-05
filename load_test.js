const https = require('https');

// CONFIG
const TARGET_URL = 'https://script.google.com/macros/s/AKfycbzbZ2uVuN1kr93pP-f8k5sTBK6ZlV8LbIx2HuYI4ufKqz7d9NL6HcnNqyFk7Gs6TANp/exec'; // Use the latest URL found
const TOTAL_REQUESTS = 50;
const CONCURRENCY = 5;

const results = {
    success: 0,
    failed: 0,
    times: []
};

async function makeRequest(id) {
    return new Promise((resolve) => {
        const start = Date.now();
        const data = JSON.stringify({ action: "get_products" });
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            },
            timeout: 10000 // 10s timeout
        };

        const req = https.request(TARGET_URL, options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                const duration = Date.now() - start;
                results.times.push(duration);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    // Check if GAS returned error in JSON
                    try {
                        const json = JSON.parse(body);
                        if(json.status === 'success') results.success++;
                        else results.failed++;
                    } catch(e) {
                        results.failed++; // HTML error page from Google
                    }
                } else {
                    results.failed++;
                }
                console.log(`Req #${id}: ${res.statusCode} (${duration}ms)`);
                resolve();
            });
        });

        req.on('error', (e) => {
            results.failed++;
            console.error(`Req #${id} Error: ${e.message}`);
            resolve();
        });

        req.write(data);
        req.end();
    });
}

async function runLoadTest() {
    console.log(`Starting Load Test: ${TOTAL_REQUESTS} requests, ${CONCURRENCY} concurrency`);
    console.log(`Target: ${TARGET_URL}`);
    
    const queue = Array.from({ length: TOTAL_REQUESTS }, (_, i) => i + 1);
    const active = [];

    while (queue.length > 0 || active.length > 0) {
        while (active.length < CONCURRENCY && queue.length > 0) {
            const id = queue.shift();
            const p = makeRequest(id).then(() => {
                active.splice(active.indexOf(p), 1);
            });
            active.push(p);
        }
        if (active.length > 0) {
            await Promise.race(active);
        }
    }

    console.log("\n--- TEST RESULTS ---");
    console.log(`Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`Success: ${results.success}`);
    console.log(`Failed: ${results.failed}`);
    if (results.times.length > 0) {
        const avg = results.times.reduce((a, b) => a + b, 0) / results.times.length;
        console.log(`Avg Time: ${avg.toFixed(2)}ms`);
        console.log(`Min Time: ${Math.min(...results.times)}ms`);
        console.log(`Max Time: ${Math.max(...results.times)}ms`);
    }
}

runLoadTest();
