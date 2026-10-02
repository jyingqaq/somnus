/**
 * 文档导入：把用户挑的文件读成纯文本，交给表单填进「详细内容」。
 *
 * 除了 readDocFile()（要碰 File）之外全是纯函数，不依赖 DOM，
 * 可以直接用 node 跑用例验证。
 *
 * 支持的范围是「能拿到文字」的文件：
 * - 纯文本：.txt / .md / .markdown / .csv / .json / .log / .text
 * - Word：.docx（本质是 zip，用浏览器自带的 DecompressionStream 解压，不引第三方库）
 * 不支持的格式（.doc / .pdf / .xlsx …）会给出明确提示，而不是把乱码塞进文本框。
 */

/** 单个文件的上限。localStorage 只有 5M，导入太大的文档会直接撑爆存档 */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

/** 交给 <input type="file"> 的过滤串。移动端认扩展名，桌面端认 MIME，都给上 */
export const DOC_ACCEPT = [
  '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.text', '.docx',
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
].join(',');

/** 纯文本扩展名 → 读的时候按文本解 */
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'text'];

/**
 * 明确读不了、值得先拦一道的格式（避免把二进制当文本解出乱码）。
 * 只列「用户很可能会选、但我们确实读不了」的，写清楚下一步该干嘛。
 */
const UNSUPPORTED = {
  doc: '旧版 .doc 读不了，用 Word 另存为 .docx 或 .txt 再导入',
  pdf: 'PDF 读不了，先复制文字出来，或另存为 .txt / .docx 再导入',
  epub: 'EPUB 读不了，先复制文字出来再导入',
  xls: '表格读不了，复制里面的文字再导入',
  xlsx: '表格读不了，复制里面的文字再导入',
  ppt: '演示文稿读不了，复制里面的文字再导入',
  pptx: '演示文稿读不了，复制里面的文字再导入'
};

/* ---------------- 文件名 / 大小 ---------------- */

/** '设定.txt' → 'txt'（统一小写，没有点号时返回空串） */
export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 1234 → '1.2 KB'，跟备份页的口径保持一致 */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 字数：过万走「万」，免得 toast 里塞一长串数字 */
export function formatCount(n) {
  const v = Number(n) || 0;
  if (v < 10000) return `${v} 字`;
  return `${(v / 10000).toFixed(1)} 万字`;
}

/* ---------------- 编码 ---------------- */

/**
 * 二进制 → 文本。
 * 中文 txt 里有大量 GBK/GB18030 存的，直接按 UTF-8 解会满屏乱码，
 * 所以先用 fatal 模式严格试一次 UTF-8，失败再退到 gb18030（GBK/GB2312 的超集）。
 */
export function decodeBuffer(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // BOM 优先，它比任何猜测都准
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // 最后的兜底，坏字符会变成 U+FFFD
    }
  }
}

/* ---------------- 文本清洗 ---------------- */

/** 统一换行、去控制字符与零宽字符、压掉连续空行。保留段落之间的单个空行 */
export function normalizeText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------- docx：zip + XML ---------------- */

const SIG_EOCD = 0x06054b50;  // 中央目录结束记录
const SIG_CEN = 0x02014b50;   // 中央目录文件头
const SIG_LOC = 0x04034b50;   // 本地文件头

const U32_MAX = 0xffffffff;

/** 从尾部往前找中央目录结束记录。注释最长 65535，所以最多回溯 64K+22 */
function findEOCD(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const min = Math.max(0, b.byteLength - 22 - 0xffff);
  for (let i = b.byteLength - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * 遍历中央目录里的所有条目 { name, method, compSize, localOff }。
 * 全部用 Uint8Array + DataView 手搓：DataView 没有 subarray，切片得靠字节视图。
 */
function centralEntries(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const eocd = findEOCD(b);
  if (eocd < 0) throw new Error('这不是一个有效的 docx 文件');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === U32_MAX) throw new Error('这个 docx 用了 ZIP64 格式，暂不支持');

  const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.byteLength || dv.getUint32(p, true) !== SIG_CEN) {
      throw new Error('docx 的目录结构损坏了');
    }
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    if (compSize === U32_MAX || localOff === U32_MAX) {
      throw new Error('这个 docx 用了 ZIP64 格式，暂不支持');
    }
    out.push({
      name: new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + nameLen)),
      method,
      compSize,
      localOff
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** raw deflate 解压。浏览器原生能力，不引第三方库 */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解析 docx，请改用 .txt 或 .md');
  }
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 取出某个条目的内容并解压 */
async function readEntry(b, entry) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lo = entry.localOff;
  if (lo + 30 > b.byteLength || dv.getUint32(lo, true) !== SIG_LOC) {
    throw new Error('docx 的目录结构损坏了');
  }
  // 本地头的文件名/extra 长度可能和中央目录里的不一致，必须重新读
  const nameLen = dv.getUint16(lo + 26, true);
  const extraLen = dv.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const data = b.subarray(start, start + entry.compSize);

  if (entry.method === 0) return data;              // 已存储
  if (entry.method !== 8) throw new Error('这个 docx 用了不支持的压缩方式');
  return inflateRaw(data);
}

/** 取出 word/document.xml 的文本；没有就返回 null */
export async function readDocxXml(buf) {
  // file.arrayBuffer() 给的是 ArrayBuffer，测试里常直接传 Buffer / Uint8Array，统一成字节视图
  const b = ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : new Uint8Array(buf);
  const entry = centralEntries(b).find((e) => e.name === 'word/document.xml');
  if (!entry) return null;
  return new TextDecoder('utf-8').decode(await readEntry(b, entry));
}

/** XML 实体反转义，顺序有讲究：&amp; 必须最后替 */
function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** 抽一个段落里的文字：w:t 是正文，w:tab / w:br 是制表符与换行 */
function paraText(p) {
  let s = '';
  // 自闭合的 <w:t/> 必须排在带正文的那条前面：
  // `<w:t\b[^>]*>` 会把 <w:t/> 的斜杠也吃掉，然后一路吞到下一个 </w:t>，把中间的文字全漏掉。
  const re = /<w:t\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) s += decodeXml(m[1]);
    else if (m[0].indexOf(':tab') > 0) s += '\t';
    else if (m[0].indexOf('noBreakHyphen') > 0) s += '-';
    else if (m[0].indexOf(':br') > 0) s += '\n';
    // <w:t/> 是空标签，不产出内容
  }
  return s;
}

/**
 * word/document.xml → 纯文本。
 * 按 <w:p> 切段落，表格单元格里的段落同样能按顺序取到。
 * 修订留下的删除文字在 <w:delText> 里，规则不匹配 w:t，自然被排除。
 */
export function docxXmlToText(xml) {
  const src = String(xml || '');
  const out = [];
  const re = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(src))) out.push(paraText(m[0]));
  return out.join('\n');
}

/* ---------------- 对外入口 ---------------- */

/** 这个文件名能不能导入：不能的话返回一句话原因，能的话返回空串 */
export function unsupportedReason(name) {
  const ext = extOf(name);
  if (ext === 'docx' || TEXT_EXT.includes(ext)) return '';
  return UNSUPPORTED[ext] || `暂不支持 .${ext} 格式，请用 .txt / .md / .docx`;
}

/**
 * 读单个文件 → { name, text }
 * 出错时抛带人话说明的 Error，调用方直接 toast 出去。
 */
export async function readDocFile(file) {
  const name = (file && file.name) || '文档';

  const blocked = unsupportedReason(name);
  if (blocked) throw new Error(blocked);

  if (file.size > MAX_DOC_BYTES) {
    throw new Error(`文件有 ${formatBytes(file.size)}，超过 ${formatBytes(MAX_DOC_BYTES)}，导入进来会撑爆存档`);
  }

  const buf = await file.arrayBuffer();
  const text = normalizeText(
    extOf(name) === 'docx' ? docxXmlToText(await readDocxXml(buf)) : decodeBuffer(buf)
  );

  if (!text) throw new Error(`「${name}」里没有读到文字`);
  return { name, text };
}

/**
 * 读一批文件，逐个兜住错误：成功的进 items，失败的进 errors。
 * 不因为一个文件失败就丢掉其它文件。
 * @returns {Promise<{items:Array<{name:string,text:string}>, errors:string[]}>}
 */
export async function readDocFiles(files) {
  const items = [];
  const errors = [];
  for (const file of Array.from(files || [])) {
    try {
      items.push(await readDocFile(file));
    } catch (e) {
      errors.push(e.message || '读取文件失败');
    }
  }
  return { items, errors };
}

/**
 * 把多个文件拼成一段可以塞进「详细内容」的文本。
 * 只导入了一个文件时不加文件名前缀，免得正文顶上多一行没用的字。
 */
export function joinDocs(items) {
  return (items || [])
    .map((it) => (items.length > 1 ? `【${it.name}】\n${it.text}` : it.text))
    .join('\n\n');
}
