// Status request shared by the options page and the service worker that owns
// the native bridge connection.
export const NATIVE_BRIDGE_STATUS_ACTION = 'getNativeBridgeStatus';

const MAX_CLIENT_VERSION_LENGTH = 64;
const MAX_ERROR_LENGTH = 256;

export function readNativeBridgeStatusResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return null;
  }
  if (response.ok !== true) {
    return null;
  }
  const status = response.status;
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return null;
  }
  if (typeof status.enabled !== 'boolean' || typeof status.connected !== 'boolean') {
    return null;
  }
  return {
    enabled: status.enabled,
    connected: status.connected,
    clientVersion: readClientVersion(status.clientVersion),
    error: typeof status.error === 'string' ? status.error.slice(0, MAX_ERROR_LENGTH) : ''
  };
}

function readClientVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const version = value.trim();
  return version && version.length <= MAX_CLIENT_VERSION_LENGTH ? version : null;
}
