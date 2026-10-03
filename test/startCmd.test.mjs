// 批处理启动脚本的格式守卫 —— start.cmd 和 push.cmd 共用一套检查。
//
// 三条硬约束（两个文件都必须满足）：
//   1. 编码 GBK（cp936）—— 中文提示才能被 cmd.exe 正确解析
//   2. 行尾纯 CRLF
//   3. 无 BOM
// 另加标签完整性、注释 ASCII、关键结构等静态检查。
//
// 为什么是 GBK 而不是 UTF-8：
//   cmd.exe 按「当前代码页」逐字节读批处理文件。chcp 65001 + UTF-8 文件时，
//   多字节中文会让读取错位，吞掉行首的 rem / echo 前缀，于是注释和长提示的
//   碎片被当命令执行。实测：UTF-8+65001 → 9 处 "is not recognized"；
//   GBK+936 → 0 处。DBCS 才是 cmd.exe 的原生菜。
//
// 用法：
//   node test/startCmd.test.mjs          # 校验，不通过 exit 1
//   node test/startCmd.test.mjs --fix    # 自动修正编码与行尾

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIX = process.argv.includes('--fix')
const GBK = 936

// must = 每个脚本自己的关键结构，被删掉就该有人喊一声
const TARGETS = [
  {
    file: 'start.cmd',
    what: '本地服务启动器',
    must: [
      [/chcp\s+936/, '缺少 chcp 936，中文提示会乱码'],
      [/http\.server/, '找不到 http.server 启动语句'],
      [/:probe/, '找不到 :probe 子过程（Python 实测逻辑）'],
    ],
  },
  {
    file: 'push.cmd',
    what: '一键推送到 GitHub',
    must: [
      [/chcp\s+936/, '缺少 chcp 936，中文提示会乱码'],
      [/push -u origin/, '找不到 git push 语句'],
      [/:probe/, '找不到 :probe 子过程（Git 实测逻辑）'],
      [/VERSION = \\x27v/, '找不到 sw.js 版本号自增逻辑'],
    ],
  },
]

const decodeWith = (raw, enc) => {
  try {
    return new TextDecoder(enc, { fatal: true }).decode(raw)
  } catch {
    return null
  }
}

const allFails = []
let exitCode = 0

for (const { file, what, must } of TARGETS) {
  const path = join(root, file)
  const fails = []
  const notes = []
  let raw = readFileSync(path)

  // ---- 1) 不许有 BOM --------------------------------------------------
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    fails.push('文件带 UTF-8 BOM，cmd.exe 会把开头的 @echo off 一起读坏')
  }

  // ---- 2) 编码必须是 GBK ----------------------------------------------
  const asciiOnly = !raw.some((b) => b > 127)
  let text = null
  let needsEncodingFix = false

  if (asciiOnly) {
    text = raw.toString('latin1') // 纯 ASCII，任何代码页都一样
    notes.push('文件是纯 ASCII，无编码歧义（但也意味着丢了中文提示）')
  } else {
    const asGbk = decodeWith(raw, 'gbk')
    const asUtf8 = decodeWith(raw, 'utf-8')
    if (asUtf8 !== null && asGbk === null) {
      // 只有 UTF-8 解得开 → 当前是 UTF-8，需要转成 GBK
      text = asUtf8
      needsEncodingFix = true
    } else if (asGbk !== null) {
      text = asGbk
    } else {
      fails.push('既不是合法 GBK 也不是合法 UTF-8，编码坏了')
    }
  }

  // ---- 3) 行尾必须是 CRLF --------------------------------------------
  let bareLf = 0
  let bareCr = 0
  if (text !== null) {
    bareLf = (text.match(/(?<!\r)\n/g) || []).length
    bareCr = (text.match(/\r(?!\n)/g) || []).length
  }
  const needLineFix = bareLf > 0 || bareCr > 0

  // ---- 执行修复 -------------------------------------------------------
  if (FIX && text !== null && (needLineFix || needsEncodingFix)) {
    const fixed = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
    // Node 的 TextEncoder 只支持 UTF-8，写 GBK 得借 PowerShell 的 936 编码器。
    const tmp = path + '.utf8.tmp'
    writeFileSync(tmp, fixed, 'utf-8')
    const esc = (p) => p.replace(/'/g, "''")
    const ps = [
      `[IO.File]::WriteAllText('${esc(path)}',`,
      ` [IO.File]::ReadAllText('${esc(tmp)}', [Text.Encoding]::UTF8),`,
      ` [Text.Encoding]::GetEncoding(${GBK}))`,
    ].join('')
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(ps, 'utf16le').toString('base64')], { stdio: 'pipe' })
      if (needsEncodingFix) notes.push('已修复：UTF-8 → GBK(cp936)')
      if (needLineFix) notes.push(`已修复：裸 LF ${bareLf} 处 / 裸 CR ${bareCr} 处 → CRLF`)
    } catch (e) {
      fails.push(`写 GBK 失败（PowerShell 转码出错）：${e.message}`)
    } finally {
      try { unlinkSync(tmp) } catch {}
    }
    raw = readFileSync(path)
    const re = decodeWith(raw, 'gbk')
    if (re !== null) text = re
    needsEncodingFix = false
  } else {
    if (needsEncodingFix) {
      fails.push('编码是 UTF-8，必须是 GBK（cp936）—— 否则 cmd.exe 会把中文当命令执行')
    }
    if (needLineFix) {
      fails.push(`行尾不是纯 CRLF：裸 LF ${bareLf} 处、裸 CR ${bareCr} 处`)
    }
  }

  // ---- 静态结构检查（基于修好之后的文本）------------------------------
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const crlfCount = text === null ? 0 : (text.match(/\r\n/g) || []).length

  // 4) 注释必须是纯 ASCII —— 双保险，即使编码对了也别在注释里堆中文
  for (const [i, ln] of lines.entries()) {
    if (!/^\s*(rem\b|::)/i.test(ln)) continue
    const bad = [...new Set([...ln].filter((c) => c.charCodeAt(0) > 127))]
    if (bad.length) fails.push(`第 ${i + 1} 行注释含非 ASCII 字符（${bad.join('')}）`)
  }

  // 5) echo 里不许有裸的重定向 / 管道符号
  //   实测踩过：`echo   sw.js 版本 -> v10，...` 里的 `-` 后面的 `>` 被 cmd 当成
  //   重定向，于是凭空生成了一个名叫「v10，已装机的用户下次打开才会拿到新代码。」
  //   的文件，下一轮又被当成新文件提交上去。要输出字面量必须写 ^> ^< ^| ^&。
  for (const [i, ln] of lines.entries()) {
    if (!/^\s*echo(\s|\.|$)/i.test(ln)) continue
    const bare = ln.replace(/\^[<>&|]/g, '')
    const hit = [...new Set([...bare].filter((c) => '<>|&'.includes(c)))]
    if (hit.length) {
      fails.push(`第 ${i + 1} 行 echo 里有未转义的 ${hit.join('')}，会被 cmd 当重定向/管道执行`)
    }
  }

  // 6) 标签完整性
  const defined = new Set()
  for (const ln of lines) {
    const m = ln.match(/^\s*:([A-Za-z0-9_]+)\s*$/)
    if (m) defined.add(m[1])
  }
  for (const [i, ln] of lines.entries()) {
    if (/^\s*rem\b/i.test(ln)) continue
    for (const m of ln.matchAll(/\bgoto\s+:?([A-Za-z0-9_]+)/gi)) {
      if (m[1].toLowerCase() !== 'eof' && !defined.has(m[1])) {
        fails.push(`第 ${i + 1} 行 goto 指向不存在的标签 :${m[1]}`)
      }
    }
    for (const m of ln.matchAll(/\bcall\s+:([A-Za-z0-9_]+)/gi)) {
      if (!defined.has(m[1])) fails.push(`第 ${i + 1} 行 call 指向不存在的标签 :${m[1]}`)
    }
  }

  // 6) 关键结构不能少
  for (const [re, msg] of must) {
    if (!re.test(text ?? '')) fails.push(msg)
  }

  // ---- 输出 -----------------------------------------------------------
  for (const n of notes) console.log('  ·', n)
  console.log(`\n${file}（${what}）: ${lines.length} 行, CRLF ${crlfCount} 处, 标签 ${defined.size} 个, 编码 ${needsEncodingFix ? 'UTF-8(应为 GBK)' : 'GBK/ASCII'}`)

  if (fails.length) {
    console.log('\n✗ 未通过：')
    for (const f of fails) console.log('  -', f)
    allFails.push(file)
    exitCode = 1
  } else {
    console.log(`✓ ${file} 格式正常（GBK / CRLF / 无 BOM / 标签完整）`)
  }
}

if (allFails.length) {
  if (!FIX) console.log('\n  跑 node test/startCmd.test.mjs --fix 可自动修编码和行尾')
  process.exit(exitCode)
}
console.log('\n✓ 全部启动脚本格式正常')
