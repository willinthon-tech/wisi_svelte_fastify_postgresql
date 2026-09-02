import crypto from 'crypto';

const dev2 = {
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

async function printCaps() {
  const endpoint = "/ISAPI/AccessControl/AcsEvent/capabilities?format=json";
  const url = `http://${dev2.ip_local}${endpoint}`;

  const res1 = await fetch(url);
  const www = res1.headers.get('www-authenticate');
  const challenge = parseDigestChallenge(www);
  const authHeader = generateDigestResponse(challenge, dev2.usuario, dev2.clave, endpoint, 'GET');

  const res2 = await fetch(url, { headers: { Authorization: 'Digest ' + authHeader } });
  const text = await res2.text();
  console.log('FULL AcsEvent CAPS FOR DS-K1T343MWX:\n', text);
}

printCaps();
