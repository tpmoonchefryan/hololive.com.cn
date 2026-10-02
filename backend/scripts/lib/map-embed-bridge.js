// One-way notification only. The parent must verify event.source against its active iframe.
export const MAP_ESCAPE_MESSAGE = Object.freeze({ type: "hololive:map-escape", version: 1 });
export const MAP_ESCAPE_BRIDGE = `<script data-hololive-map-escape>document.addEventListener("keydown",function(event){if(event.key==="Escape"&&window.parent!==window){window.parent.postMessage({type:"hololive:map-escape",version:1},"*");}},true);</script>`;
export function injectMapEscapeBridge(html) {
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, "$&" + MAP_ESCAPE_BRIDGE);
  return MAP_ESCAPE_BRIDGE + html;
}
