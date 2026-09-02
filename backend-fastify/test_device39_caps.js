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
  if (challenge.opaque) digestResponse += ', opaque="' + challenge.opaque + '"';
  return digestResponse;
}

async function testCap(endpoint) {
  console.log(`\nTesting DS-K1T343MWX (192.168.3.174): GET ${endpoint}...`);
  const deviceUrl = `http://${dev2.ip_local}`;
  const fullUrl = deviceUrl + endpoint;

  try {
    const res1 = await fetch(fullUrl, { method: 'GET' });
    const wwwAuthenticate = res1.headers.get('www-authenticate');

    if (wwwAuthenticate && wwwAuthenticate.includes('Digest')) {
      const challenge = parseDigestChallenge(wwwAuthenticate);
      const digestHeader = generateDigestResponse(challenge, dev2.usuario, dev2.clave, endpoint, 'GET');
      
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);

      const res2 = await fetch(fullUrl, {
        method: 'GET',
        headers: { Authorization: 'Digest ' + digestHeader },
        signal: controller.signal
      });
      clearTimeout(t);

      const text = await res2.text();
      console.log(`🎉 SUCCESS for GET ${endpoint}! Status: ${res2.status}`);
      console.log(`   XML/JSON:`, text.substring(0, 500));
      return true;
    }
  } catch (e) {
    console.log(`❌ Error for GET ${endpoint}:`, e.message);
  }
  return false;
}

async function runAll() {
  await testCap("/ISAPI/AccessControl/AcsEvent/capabilities?format=json");
  await testCap("/ISAPI/AccessControl/capabilities?format=json");
  await testCap("/ISAPI/AccessControl/AcsEvent/capabilities");
  await testCap("/ISAPI/AccessControl/capabilities");
}

runAll();
