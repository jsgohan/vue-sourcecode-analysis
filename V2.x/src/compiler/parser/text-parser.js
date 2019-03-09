/* @flow */

import { cached } from 'shared/util'
import { parseFilters } from './filter-parser'

const defaultTagRE = /\{\{((?:.|\n)+?)\}\}/g
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g

// Vue可以通过delimiters选项自定义字面量表达式的分隔符，比如可以将其配置成delimiters: ['${', '}']
// 可以使用open和close常量的内容替换掉默认的{{}}
const buildRegex = cached(delimiters => {
  // 对于特殊意义的符号，需要转义，转义的结果就是在具有特殊意义的字符前面添加字符\，所以最终open常量的值将为'\$\{'
  const open = delimiters[0].replace(regexEscapeRE, '\\$&')
  const close = delimiters[1].replace(regexEscapeRE, '\\$&')
  return new RegExp(open + '((?:.|\\n)+?)' + close, 'g')
})

type TextParseResult = {
  expression: string,
  tokens: Array<string | { '@binding': string }>
}

export function parseText (
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE
  if (!tagRE.test(text)) {
    return
  }
  const tokens = []
  const rawTokens = []
  let lastIndex = tagRE.lastIndex = 0
  let match, index, tokenValue
  // 将匹配结果保存在match变量中，直到匹配失败循环才会终止，意味着所有的字面量表达式都已处理完毕了
  while ((match = tagRE.exec(text))) {
    index = match.index
    // push text token
    if (index > lastIndex) {
      // 举例 'abc{{name}}'，此时以下会相当于'abc{{name}}'.slice(0, 3) 也就是返回原始文本的'abc'
      // 并保存在tokenValue中，push到rawTokens数组中
      rawTokens.push(tokenValue = text.slice(lastIndex, index))
      tokens.push(JSON.stringify(tokenValue))
    }
    // tag token
    // 匹配结果的捕获内容，举例'abc{{name | someFilters}}'
    // 此时返回的exp为'_f("someFilters")(name)'
    // 所以tokens数组和rawTokens数组分别为
    // tokens = ["'abc'", '_s(_f("someFilters")(name))']
    // rawTokens = [
    //   'abc',
    //   {
    //     '@binding': "_s(_f('someFilters')(name))"
    //   }
    // ]
    const exp = parseFilters(match[1].trim())
    tokens.push(`_s(${exp})`)
    rawTokens.push({ '@binding': exp })
    // 更新lastIndex变量的值，lastIndex变量的值等于index变量的值加上匹配的字符串的长度
    lastIndex = index + match[0].length
  }
  // 当lastIndex变量的值和原始文本长度text.length的大小比较，lastIndex变量的值小于原始文本长度时
  // 剩余的普通文本将其添加到rawTokens和tokens数组中
  // 举例 'abc{{name | someFilters}}def'，最终解析为：
  // tokens = ["'abc'", '_s(_f("someFilters")(name))', 'def']
  // rawTokens = [
  //   'abc',
  //   {
  //     '@binding': "_s(_f('someFilters')(name))"
  //   },
  //   'def'
  // ]
  if (lastIndex < text.length) {
    rawTokens.push(tokenValue = text.slice(lastIndex))
    tokens.push(JSON.stringify(tokenValue))
  }
  // tokens是用来给weex使用的
  return {
    expression: tokens.join('+'),
    tokens: rawTokens
  }
}
