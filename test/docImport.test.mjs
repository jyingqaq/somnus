import { readFileSync } from 'node:fs';
import {
  extOf, formatBytes, formatCount, decodeBuffer, normalizeText,
  docxXmlToText, readDocFile, readDocFiles, joinDocs,
  unsupportedReason, DOC_ACCEPT, MAX_DOC_BYTES
} from '../js/services/docImport.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ('  -> ' + extra) : '')); }
};
const eq = (name, got, want) =>
  ok(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

console.log('\n== 基础工具 ==');
eq('extOf txt', extOf('设定.txt'), 'txt');
eq('extOf DOCX 大写', extOf('A.DOCX'), 'docx');
eq('extOf 无扩展名', extOf('README'), '');
eq('formatBytes B', formatBytes(512), '512 B');
eq('formatBytes KB', formatBytes(1536), '1.5 KB');
eq('formatBytes MB', formatBytes(2 * 1024 * 1024), '2.0 MB');
eq('formatCount 字', formatCount(320), '320 字');
eq('formatCount 万', formatCount(25000), '2.5 万字');

console.log('\n== 编码探测 ==');
eq('utf8 中文', decodeBuffer(new TextEncoder().encode('林晚推开门')), '林晚推开门');
eq('utf8 BOM', decodeBuffer(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('角色')])), '角色');
eq('gbk 中文', decodeBuffer(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文');
ok('DOC_ACCEPT 含 .docx', DOC_ACCEPT.includes('.docx'));
ok('DOC_ACCEPT 含 .txt', DOC_ACCEPT.includes('.txt'));
eq('MAX_DOC_BYTES = 2MB', MAX_DOC_BYTES, 2 * 1024 * 1024);

console.log('\n== 文本清洗 ==');
eq('CRLF 归一', normalizeText('a\r\nb'), 'a\nb');
eq('连续空行压缩', normalizeText('a\n\n\n\n\nb'), 'a\n\nb');
eq('去首尾空白', normalizeText('  \n a \n  '), 'a');
eq('不换行空格转普通空格', normalizeText('a b'), 'a b');
eq('零宽字符剔除', normalizeText('ab'), 'ab');
eq('保留单个空行', normalizeText('a\n\nb'), 'a\n\nb');
eq('空输入', normalizeText(''), '');
eq('null 输入', normalizeText(null), '');

console.log('\n== 不支持的格式拦截 ==');
ok('doc 被拦', unsupportedReason('a.doc').includes('.doc'));
ok('pdf 被拦', unsupportedReason('a.pdf').includes('PDF'));
eq('txt 放行', unsupportedReason('a.txt'), '');
eq('md 放行', unsupportedReason('a.md'), '');
eq('csv 放行', unsupportedReason('a.csv'), '');
eq('docx 放行', unsupportedReason('a.docx'), '');
ok('未知格式有提示', unsupportedReason('a.xyz').length > 0);

console.log('\n== XML 抽文 ==');
const xml = '<w:document><w:body>'
  + '<w:p><w:r><w:t>甲</w:t></w:r><w:r><w:t>乙</w:t></w:r></w:p>'
  + '<w:p><w:r><w:tab/><w:t>制表</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>a &amp; b &lt;c&gt; &#65;</w:t></w:r></w:p>'
  + '<w:p><w:r><w:delText>被删掉的</w:delText><w:t>保留</w:t></w:r></w:p>'
  + '<w:p/>'
  + '</w:body></w:document>';
// 第二段的 <w:tab/> 应还原成制表符；末尾 <w:p/> 是空段落
eq('多 run 合并 / 转义 / delText 排除 / 空段落', docxXmlToText(xml), '甲乙\n\t制表\na & b <c> A\n保留\n');

// 自闭合 <w:t/> 不能把后面一个段落的文字吞掉
const xml2 = '<w:body><w:p><w:r><w:t/></w:r><w:r><w:t>紧跟其后</w:t></w:r></w:p></w:body>';
eq('自闭合 w:t 不吞字', docxXmlToText(xml2), '紧跟其后');

// 一段里多次 br
eq('多个 w:br 各自换行', docxXmlToText('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>'), 'a\nb\nc');

console.log('\n== 真实 docx 端到端 ==');
const docxBuf = readFileSync(new URL('./测试角色设定.docx', import.meta.url));
const got = await readDocFile({
  name: '测试角色设定.docx', size: docxBuf.length, arrayBuffer: async () => docxBuf
});
console.log('--- 抽取结果 ---');
console.log(got.text);
console.log('--- 结束 ---');
ok('docx 抽到中文', got.text.includes('林晚推开门的时候'));
ok('docx 标题行', got.text.includes('第一章 雨夜'));
ok('docx 实体已反转义', got.text.includes('& <标签> "引号" AB'));
ok('docx 保留制表符', got.text.includes('\t'));
ok('docx 无 xml 标签残留', !got.text.includes('<w:') && !got.text.includes('</w:'));
ok('docx 无 PK 压缩头', !got.text.includes('PK'));
eq('docx 返回文件名', got.name, '测试角色设定.docx');

console.log('\n== 多文件与合并 ==');
const enc = new TextEncoder();
const mk = (name, text, fail) => ({
  name, size: 10, arrayBuffer: async () => { if (fail) throw new Error('boom'); return enc.encode(text); }
});
// 四个文件：两个正常文本 + 一个读取抛错 + 一个格式不被支持
const multi = await readDocFiles([
  mk('a.txt', '角色甲设定'), mk('b.md', '角色乙设定'), mk('c.log', 'x', true), mk('d.doc', 'y')
]);
eq('成功 2 个', multi.items.length, 2);
eq('失败 2 个', multi.errors.length, 2);
ok('多文件带文件名分隔', joinDocs(multi.items).includes('【a.txt】'));
ok('单文件不加前缀', !joinDocs([{ name: 'a.txt', text: 'x' }]).includes('【'));

// 全军覆没时 items 为空，调用方要能自己判断
const none = await readDocFiles([mk('x.doc', 'y')]);
eq('全失败 items 为空', none.items.length, 0);
ok('全失败仍有错误说明', none.errors.length === 1 && none.errors[0].length > 0);

console.log('\n== 超限与异常 ==');
const bigRes = await readDocFile({
  name: 'big.txt', size: MAX_DOC_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0)
}).then(() => null, (e) => e.message);
ok('超 2MB 被拦', /超过/.test(bigRes || ''), bigRes);

const emptyRes = await readDocFile({
  name: 'e.txt', size: 0, arrayBuffer: async () => new ArrayBuffer(0)
}).then(() => null, (e) => e.message);
ok('空文件有提示', /没有读到文字/.test(emptyRes || ''), emptyRes);

const badRes = await readDocFile({
  name: 'x.docx', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4])
}).then(() => null, (e) => e.message);
ok('坏 docx 有提示', !!badRes, badRes);

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
