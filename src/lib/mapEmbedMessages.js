// The sandbox has an opaque origin: source identity, not "null", binds this bridge.
export function isMapEscapeMessage(event, frame) {
  const data = event.data;
  return Boolean(frame?.contentWindow) && event.source === frame.contentWindow &&
    data !== null && typeof data === "object" && !Array.isArray(data) &&
    Object.keys(data).length === 2 && data.type === "hololive:map-escape" && data.version === 1;
}
