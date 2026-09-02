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

  const ha1String = username + ":" + realm + ":" + password;
  const ha1 = crypto.createHash("md5").update(ha1String).digest("hex");

  const ha2String = method + ":" + uri;
  const ha2 = crypto.createHash("md5").update(ha2String).digest("hex");

  let response;
  if (qop === "auth") {
    const responseString = ha1 + ":" + nonce + ":00000001:" + cnonce + ":" + qop + ":" + ha2;
    response = crypto.createHash("md5").update(responseString).digest("hex");
  } else {
    const responseString = ha1 + ":" + nonce + ":" + ha2;
    response = crypto.createHash("md5").update(responseString).digest("hex");
  }

  let digestResponse = 'username="' + username + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + uri + '", response="' + response + '"';
  if (qop) digestResponse += ', qop=' + qop + ', nc=00000001, cnonce="' + cnonce + '"';
  return digestResponse;
}

async function testWithStart(label, startTimeStr) {
  console.log(`\nTesting DS-K1T343MWX (192.168.3.174): [${label}]...`);
  const endpoint = "/ISAPI/AccessControl/AcsEvent?format=json";
  const url = `http://${dev2.ip_local}${endpoint}`;
  const bodyStr = JSON.stringify({
    AcsEventCond: {
      searchID: "1",
      searchResultPosition: 0,
      maxResults: 30,
      major: 5,
      minor: 0,
      startTime: startTimeStr,
      endTime: "2035-12-31T23:59:59-04:00"
    }
  });

  try {
    const res1 = await fetch(url, { method: 'POST', body: bodyStr, headers: { 'Content-Type': 'application/json' } });
    const www = res1.headers.get('www-authenticate');

    if (www && www.includes('Digest')) {
      const challenge = parseDigestChallenge(www);
      const digestHeader = generateDigestResponse(challenge, dev2.usuario, dev2.clave, endpoint, 'POST');

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 15000);

      const start = Date.now();
      const res2 = await fetch(url, {
        method: 'POST',
        body: bodyStr,
        headers: { 'Content-Type': 'application/json', Authorization: 'Digest ' + digestHeader },
        signal: controller.signal
      });
      clearTimeout(t);

      const text = await res2.text();
      console.log(`🎉 SUCCESS for [${label}]! Status: ${res2.status} in ${Date.now() - start}ms`);
      console.log(`   Response text:`, text.substring(0, 600));
      return true;
    }
  } catch (e) {
    console.log(`❌ Error for [${label}]:`, e.message);
  }
  return false;
}

async function runAll() {
  await testWithStart("Start from 2026-08-25T00:00:00-04:00", "2026-08-25T00:00:00-04:00");
  await testWithStart("Start from 2026-08-01T00:00:00-04:00", "2026-08-01T00:00:00-04:00");
}

runAll();
