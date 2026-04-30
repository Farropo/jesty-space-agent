const USER_CRYPTO_PREFIX = "userCrypto:";

function cloneConfig(config = {}) {
  return JSON.parse(JSON.stringify(config && typeof config === "object" ? config : {}));
}

function getUserCrypto(runtime = globalThis.space) {
  return runtime?.utils?.userCrypto && typeof runtime.utils.userCrypto === "object"
    ? runtime.utils.userCrypto
    : null;
}

function isEncryptedSecret(value) {
  return String(value || "").startsWith(USER_CRYPTO_PREFIX);
}

export async function encryptMissionControlSecrets(config = {}, runtime = globalThis.space) {
  const nextConfig = cloneConfig(config);
  const userCrypto = getUserCrypto(runtime);
  const preferences = nextConfig.modelPreferences && typeof nextConfig.modelPreferences === "object"
    ? nextConfig.modelPreferences
    : null;

  if (!preferences || !preferences.apiKey || isEncryptedSecret(preferences.apiKey)) {
    return nextConfig;
  }

  if (!userCrypto || typeof userCrypto.encryptText !== "function") {
    return nextConfig;
  }

  const encryptedValue = await userCrypto.encryptText(String(preferences.apiKey || ""));
  if (encryptedValue) {
    preferences.apiKey = encryptedValue;
  }

  return nextConfig;
}

export async function decryptMissionControlSecrets(config = {}, runtime = globalThis.space) {
  const nextConfig = cloneConfig(config);
  const userCrypto = getUserCrypto(runtime);
  const preferences = nextConfig.modelPreferences && typeof nextConfig.modelPreferences === "object"
    ? nextConfig.modelPreferences
    : null;

  if (!preferences || !isEncryptedSecret(preferences.apiKey)) {
    return nextConfig;
  }

  if (!userCrypto || typeof userCrypto.decryptText !== "function") {
    return nextConfig;
  }

  const decryptedValue = await userCrypto.decryptText(preferences.apiKey);
  if (decryptedValue) {
    preferences.apiKey = decryptedValue;
  }

  return nextConfig;
}
