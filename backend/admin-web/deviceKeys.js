const DATABASE_NAME = "zbt-admin-device-v1";
const STORE_NAME = "identities";
const CURRENT_IDENTITY_KEY = "current";

let activeIdentityPromise;

export function getOrCreateDeviceIdentity() {
  if (!activeIdentityPromise) {
    activeIdentityPromise = loadOrCreateIdentity().catch((error) => {
      activeIdentityPromise = null;
      throw error;
    });
  }
  return activeIdentityPromise;
}

export async function signChallenge(identity, payload) {
  if (!validIdentity(identity) || typeof payload !== "string" || !payload) {
    throw new TypeError("设备签名参数无效");
  }
  const bytes = new TextEncoder().encode(payload);
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.privateKey,
    bytes
  );
  return bytesToBase64URL(new Uint8Array(signature));
}

export function canonicalChallengePayload({ challengeID, purpose, nonce, targetID = "" } = {}) {
  const fields = [
    challengeField(challengeID, 160, false),
    challengeField(purpose, 40, false),
    challengeField(nonce, 256, false),
    challengeField(targetID, 160, true)
  ];
  return ["zbt-admin-v1", ...fields].join("\n");
}

async function loadOrCreateIdentity() {
  assertBrowserCrypto();
  const database = await openDatabase();
  try {
    const existing = await readIdentity(database);
    if (validIdentity(existing)) return existing;
    const pair = await globalThis.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"]
    );
    const candidate = {
      deviceID: globalThis.crypto.randomUUID(),
      privateKey: pair.privateKey,
      publicKeyJWK: await globalThis.crypto.subtle.exportKey("jwk", pair.publicKey)
    };
    return claimIdentity(database, candidate);
  } finally {
    database.close();
  }
}

function validIdentity(identity) {
  return Boolean(
    identity &&
    typeof identity.deviceID === "string" &&
    identity.deviceID &&
    identity.privateKey?.type === "private" &&
    identity.privateKey?.extractable === false &&
    identity.privateKey?.algorithm?.name === "ECDSA" &&
    identity.privateKey?.algorithm?.namedCurve === "P-256" &&
    identity.publicKeyJWK?.kty === "EC" &&
    identity.publicKeyJWK?.crv === "P-256"
  );
}

function assertBrowserCrypto() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
    throw new Error("当前浏览器不支持安全设备密钥存储");
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开设备密钥存储"));
    request.onblocked = () => reject(new Error("设备密钥存储正在被其他窗口占用"));
  });
}

function readIdentity(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(CURRENT_IDENTITY_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error("无法读取设备密钥"));
  });
}

function claimIdentity(database, candidate) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(CURRENT_IDENTITY_KEY);
    let selected = candidate;
    request.onsuccess = () => {
      if (validIdentity(request.result)) {
        selected = request.result;
      } else {
        store.put(candidate, CURRENT_IDENTITY_KEY);
      }
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(selected);
    transaction.onerror = () => reject(new Error("无法保存设备密钥"));
    transaction.onabort = () => reject(new Error("设备密钥保存已取消"));
  });
}

function bytesToBase64URL(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function challengeField(value, limit, optional) {
  if (optional && value == null) return "";
  if (typeof value !== "string" || (!optional && !value) ||
      Array.from(value).length > limit || /[\r\n\u0000]/u.test(value)) {
    throw new TypeError("挑战数据无效");
  }
  return value;
}
