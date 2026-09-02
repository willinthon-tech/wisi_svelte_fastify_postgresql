import crypto from 'crypto';

const dev2 = {
  id: 39,
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
  if (challenge.opaque) digestResponse += ', opaque="' + challenge.opaque + '"';
  return digestResponse;
}

async function makeDigestRequest(deviceUrl, endpoint, method, body, credentials) {
  const username = credentials.usuario;
  const password = credentials.clave;
  const fullUrl = endpoint.startsWith('http') ? endpoint : (deviceUrl + endpoint);
  const uriPath = endpoint.startsWith('http') ? (new URL(endpoint).pathname + new URL(endpoint).search) : endpoint;
  const reqHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  try {
    const res1 = await fetch(fullUrl, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: reqHeaders
    });

    if (res1.status === 401 && res1.headers.get('www-authenticate')) {
      const wwwAuthenticate = res1.headers.get('www-authenticate');
      if (wwwAuthenticate.includes('Digest')) {
        const challenge = parseDigestChallenge(wwwAuthenticate);
        const digestHeader = generateDigestResponse(challenge, username, password, uriPath, method);
        
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 20000);

        const res2 = await fetch(fullUrl, {
          method,
          body: body ? JSON.stringify(body) : undefined,
          headers: { ...reqHeaders, Authorization: 'Digest ' + digestHeader },
          signal: controller.signal
        });
        clearTimeout(t);

        const text = await res2.text();
        return { status: res2.status, data: text };
      }
    }
    const text = await res1.text();
    return { status: res1.status, data: text };
  } catch (err) {
    throw err;
  }
}

async function testDevice39() {
  console.log(`📡 Testing Digest Request on Device #39 (http://192.168.3.174)...`);
  const deviceUrl = `http://${dev2.ip_local}`;

  // Test 1: deviceInfo
  try {
    const resInfo = await makeDigestRequest(deviceUrl, '/ISAPI/System/deviceInfo', 'GET', null, dev2);
    console.log(`✅ deviceInfo Status:`, resInfo.status);
    console.log(`   Model / Serial:`, resInfo.data.substring(0, 300));
  } catch (e) {
    console.error(`❌ deviceInfo Error:`, e.message);
  }

  // Test 2: AcsEvent
  const batchBody = {
    AcsEventCond: {
      searchID: "1",
      searchResultPosition: 0,
      maxResults: 30,
      major: 5,
      minor: 0,
      startTime: "2025-01-01T00:00:00-04:00",
      endTime: "2035-12-31T23:59:59-04:00"
    }
  };

  try {
    const resEvents = await makeDigestRequest(deviceUrl, '/ISAPI/AccessControl/AcsEvent?format=json', 'POST', batchBody, dev2);
    console.log(`✅ AcsEvent Status:`, resEvents.status);
    console.log(`   AcsEvent Data:`, resEvents.data.substring(0, 400));
  } catch (e) {
    console.error(`❌ AcsEvent Error:`, e.message);
  }
}

testDevice39();
