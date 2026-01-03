/**
 * Direct Alloy -> Loki E2E test
 * Bypasses otlp.recoverysky.app to test the pipeline directly
 *
 * Run: node app/utils/logger/direct-e2e.mjs
 */

const ALLOY_ENDPOINT = "https://alloy.rso:14318";
const LOKI_URL = "https://loki.rso:3100";

const testId = `direct-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const timestamp = Date.now();

async function main() {
  console.log("🧪 Direct Alloy -> Loki E2E Test");
  console.log(`   Test ID: ${testId}`);
  console.log(`   Alloy: ${ALLOY_ENDPOINT}`);
  console.log(`   Loki: ${LOKI_URL}\n`);

  // 1. Send log to Alloy
  console.log("📝 Sending log to Alloy...");
  const payload = {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "direct-e2e-test" } },
          { key: "service.version", value: { stringValue: "1.0.0" } }
        ]
      },
      scopeLogs: [{
        scope: { name: "e2e-test", version: "1.0.0" },
        logRecords: [{
          timeUnixNano: String(timestamp * 1000000),
          severityNumber: 9,
          severityText: "INFO",
          body: { stringValue: `Direct E2E test message: ${testId}` },
          attributes: [
            { key: "testId", value: { stringValue: testId } }
          ]
        }]
      }]
    }]
  };

  const sendRes = await fetch(`${ALLOY_ENDPOINT}/v1/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const sendBody = await sendRes.text();
  console.log(`   Response: ${sendRes.status} ${sendBody}`);

  if (!sendRes.ok) {
    console.log("❌ Failed to send to Alloy");
    process.exit(1);
  }
  console.log("✅ Log sent to Alloy\n");

  // 2. Wait for ingestion
  console.log("⏳ Waiting 15s for Loki ingestion...");
  await new Promise(r => setTimeout(r, 15000));

  // 3. Query Loki
  console.log("🔍 Querying Loki...");
  const startNano = String((timestamp - 60000) * 1000000);
  const endNano = String((Date.now() + 60000) * 1000000);
  const query = encodeURIComponent(`{service_name="direct-e2e-test"} |= "${testId}"`);

  const lokiUrl = `${LOKI_URL}/loki/api/v1/query_range?query=${query}&start=${startNano}&end=${endNano}&limit=10`;
  console.log(`   URL: ${lokiUrl}\n`);

  const lokiRes = await fetch(lokiUrl);
  const lokiText = await lokiRes.text();

  if (!lokiText) {
    console.log("❌ Loki returned empty response");
    process.exit(1);
  }

  const lokiData = JSON.parse(lokiText);
  console.log(`   Status: ${lokiData.status}`);
  console.log(`   Results: ${lokiData.data?.result?.length || 0} streams\n`);

  if (lokiData.data?.result?.length > 0) {
    console.log("✅ SUCCESS! Log found in Loki!");
    const stream = lokiData.data.result[0];
    console.log(`   Stream labels: ${JSON.stringify(stream.stream)}`);
    console.log(`   Log line: ${stream.values[0][1].substring(0, 100)}...`);
    process.exit(0);
  } else {
    console.log("❌ Log NOT found in Loki");
    console.log("   The log was sent to Alloy but didn't appear in Loki.");
    console.log("   Check Alloy -> Loki pipeline configuration.");
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
