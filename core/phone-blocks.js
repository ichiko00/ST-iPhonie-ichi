// Only consume real phone blocks. Examples in reasoning/comments/code are not messages.
export function phoneMatches(value) {
  const text = String(value ?? '');
  const protectedRanges = [];
  const protectedText = /<!--[\s\S]*?(?:-->|$)|<(blend|think|thinking|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?(?:\2|$)|(`+)[^\r\n]*?\3/gi;
  for (const m of text.matchAll(protectedText)) protectedRanges.push([m.index, m.index + m[0].length]);
  // A nested opening tag means the earlier tag was an example or an incomplete block.
  const tag = /<phone\b([^>]*)>((?:(?!<phone\b|<\/?(?:blend|think|thinking|analysis|content)\b)[\s\S])*?)<\/phone\s*>/gi;
  return [...text.matchAll(tag)].filter(m => !protectedRanges.some(([a, b]) => m.index < b && m.index + m[0].length > a));
}

export function replacePhoneBlocks(value, replace) {
  const text = String(value ?? '');
  let result = '', offset = 0;
  for (const m of phoneMatches(text)) {
    result += text.slice(offset, m.index) + replace(m[0], m[1], m[2]);
    offset = m.index + m[0].length;
  }
  return result + text.slice(offset);
}
