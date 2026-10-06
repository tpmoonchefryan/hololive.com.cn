// One-way notification only. The parent must verify event.source against its active iframe.
export const MAP_ESCAPE_MESSAGE = Object.freeze({ type: "hololive:map-escape", version: 1 });
export const MAP_ESCAPE_BRIDGE = `<script data-hololive-map-escape>document.addEventListener("keydown",function(event){if(event.key==="Escape"&&window.parent!==window){window.parent.postMessage({type:"hololive:map-escape",version:1},"*");}},true);</script>`;
// The map keeps its opaque origin (no allow-same-origin). Dynmap reads document.cookie on startup,
// which throws there, and jQuery's X-Requested-With would force a CORS preflight on every poll.
// Cookie access becomes inert (reads "", writes are dropped) and that header is dropped.
// This grants no storage, messaging or same-origin capability.
export const MAP_SANDBOX_COMPAT = `<script data-hololive-map-sandbox-compat>(function(){try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return ""},set:function(){}});}catch(e){}var p=XMLHttpRequest.prototype,s=p.setRequestHeader;p.setRequestHeader=function(n,v){if(String(n).toLowerCase()==="x-requested-with")return;return s.call(this,n,v);};})();</script>`;
// Both scripts open <head>, ahead of every upstream script.
export function injectMapEscapeBridge(html) {
  const scripts = MAP_ESCAPE_BRIDGE + MAP_SANDBOX_COMPAT;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + scripts);
  return scripts + html;
}
