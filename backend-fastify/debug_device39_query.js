import crypto from 'crypto';

const dev2 = {
  nombre: "Marcaje Personal ( Roraima )",
  ip_local: "192.168.3.174",
  usuario: "admin",
  clave: "Jjnc0412"
};

function parseDigestChallenge(wwwAuthenticate) {
  const challenge = {};
  const regex = /(\w+)=["']?([^"',]+)["']?/g;
  let match;
  while ((match = regex.exec(wwwAuthenticate)) !== null) {
    challenge[match[1]] = match[2];
  }
  return challenge;
}

function generateDigestResponse(challenge, username, password, uri, method) {
  const realm = challenge.realm || "";
  const nonce = challenge.nonce || "";
  const qop = challenge.qop || "";
  const cnonce = crypto.randomBytes(16).toString("hex");

  const ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
  const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");

  let response = qop === "auth"
    ? crypto.createHash("md5").update(`${ha1}:${nonce}:00000001:${cnonce}:${qop}:${ha2}`).digest("hex")
    : crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");

  let header = `username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=00000001, cnonce="${cnonce}"`;
  return header;
}

async function testQuery(label, acsEventCond) {
  console.log(`\nTesting DS-K1T343MWX: [${label}]...`);
  const url = `http://${dev2.ip_local}/ISAPI/AccessControl/AcsEvent?format=json`;
  const body = JSON.stringify({ AcsEventCond: acsEventCond });

  try {
    const res1 = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    const authHeaderRaw = res1.headers.get('www-authenticate');

    if (authHeaderRaw && authHeaderRaw.includes('Digest')) {
      const challenge = parseDigestChallenge(authHeaderRaw);
      const authHeader = generateDigestResponse(challenge, dev2.usuario, dev2.clave, '/ISAPI/AccessControl/AcsEvent?format=json', 'POST');
      
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);

      const res2 = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Digest ' + authHeader },
        signal: controller.signal
      });
      clearTimeout(t);

      const text = await res2.text();
      console.log(`✅ Result for [${label}]: Status ${res2.status}`);
      console.log(`   Response:`, text.substring(0, 400));
    }
  } catch (e) {
    console.log(`❌ Error for [${label}]:`, e.message);
  }
}

async function runAll() {
  await testQuery("Recent Date 2026-08-01", {
    searchID: "1",
    searchResultPosition: 0,
    maxResults: 10,
    major: 5,
    minor: 0,
    startTime: "2026-08-01T00:00:00-04:00",
    endTime: "2026-08-30T23:59:59-04:00"
  });

  await testQuery("No dates specified", {
    searchID: "1",
    searchResultPosition: 0,
    maxResults: 10,
    major: 5,
    minor: 0
  });
}

runAll();
