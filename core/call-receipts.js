// Separate from source-owned messages: answering makes a call independent of story rollback.
const KEY='myphone-call-receipts-v1';
export function callReceiptKey(ref){return ref?.story&&ref?.ver?ref.story+'|'+ref.ver:'';}
export function hasCallReceipt(ref){try{return !!JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}')[callReceiptKey(ref)];}catch{return false;}}
export function markCallReceipt(ref){const key=callReceiptKey(ref);if(!key)return;try{const data=JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}');data[key]=Date.now();globalThis.localStorage?.setItem(KEY,JSON.stringify(data));}catch{}}
