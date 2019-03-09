/* @flow */

const validDivisionCharRE = /[\w).+\-_$\]]/

/**
 * 处理类似于<div>{{date | format('yy-mm-dd')}}</div> 或<div :key="id | featId"></div>
 * 将值分为两部分，一部分称为表达式，另一部分则是过滤器函数，然后再将这两部分结合在一起
 * <div :key="id | featId"></div> key的值为id | featId，分成两部分
 * 第一部分，表达式：id
 * 第二部分，过滤器：featId
 * 但是并不是简单的区分字符串的管道符|，因为存在多种情况需要过滤掉，如
 * <div :key="'id | featId'"></div> 
 * <div :key='"id | featId"'></div> 
 * <div :key="`id | featId`"></div> 
 * <div :key="/id|featId/.test(id).toString()"></div> 正则表达式中的管道符
 * 最为麻烦的就是识别正则表达，容易和除法运算符混淆，要结合语境才能知道/代表的是什么含义，例如
 * a = b
 * /hi/g.exec(c).map(d)
 * 实际上上这代表的是除法，等价于 a = b / hi / g.exec(c).map(d)
 * 继续举例：
 * 例1
 * function f() {}
 * /1/g
 * 例2
 * var a = {}
 * /1/g
 * 实际这里的问题就在于}符号，例1指代的是正则，因为上者是个函数定义，例2指代的是除法，因为上者是个表达式，{}代表对象字面量
 * 对于这些的复杂性，是不切实际的，因此实际该函数考虑的还是很小的一部分，但对Vue来说，已经足够了。因为这些完全可以放在计算属性中实现
 * <div :key="id || featId"></div> 逻辑或运算符
 * 其实还有存在歧义的地方，如按位或运算符，这种情况，框架直接抛弃按位或运算符的操作，但实际上这类的操作是可以直接交个计算属性实现的
 */
export function parseFilters (exp: string): string {
  // 代表字符串是否以'开始，是则返回true，所以这些字符都会被当做普通字符串的一部分来处理，知道解析器遇到了下一个能代表字符串结束的单引号为止，就会重新将inSingle设置为false
  let inSingle = false
  // 同上，表示是否为双引号包裹
  let inDouble = false
  // 表示是否在模板字符串中
  let inTemplateString = false
  // 表示是否在正则表达式中
  let inRegex = false
  // 当每遇到一个管道符时，不应该作为过滤器的分界线，还要看以下三个变量是否为0，如果以下至少有一个不为0，说明该管道符存在于括号中，不会被作为过滤器的分界线
  // 每遇到一个左花括号{，则变量值加1，每遇到一个}，则变量值减1
  let curly = 0
  // 每遇到一个左方括号[，则变量值加1，每遇到一个]，则变量值减1
  let square = 0
  // 每遇到一个左圆括号(，加1，),减1
  let paren = 0
  // 属性值字符串中字符的索引，将会被用来确定过滤器的位置
  let lastFilterIndex = 0
  /** 
   * c为当前字符对应的ASCII码
   * prev保存当前字符的前一个字符所对应的ASCII码
   * i为当前读入字符的位置索引
   * expression是函数的返回值
   * filters会是一个数组，保存着所有过滤器函数名 
  */
  let c, prev, i, expression, filters

  // 将属性值字符串作为字符流读入，从第一个字符开始一直读到字符串的末尾
  for (i = 0; i < exp.length; i++) {
    prev = c
    c = exp.charCodeAt(i)
    if (inSingle) {
      // 如果当前读取的字符存在于由单引号包裹的字符串内，则会执行这里的代码
      // 以下两个0x27代表'，0x5C代表\，当前是'，前一个字符不是反斜杠\，代表字符串结束
      if (c === 0x27 && prev !== 0x5C) inSingle = false
    } else if (inDouble) {
      // 如果当前读取的字符存在于由双引号包裹的字符串内，则会执行这里的代码
      if (c === 0x22 && prev !== 0x5C) inDouble = false
    } else if (inTemplateString) {
      // 如果当前读取的字符存在于模板字符串内，则会执行这里的代码
      if (c === 0x60 && prev !== 0x5C) inTemplateString = false
    } else if (inRegex) {
      // 如果当前读取的字符存在于正则表达式内，则会执行这里的代码
      if (c === 0x2f && prev !== 0x5C) inRegex = false
    } else if (
      c === 0x7C && // pipe |
      exp.charCodeAt(i + 1) !== 0x7C &&
      exp.charCodeAt(i - 1) !== 0x7C &&
      !curly && !square && !paren
    ) {
      // 如果当前读取的字符是过滤器的分界线，则会执行这里的代码
      /**
       * 进入条件
       * 1. 当前字符对应ASCII码必须是0x7C
       * 2. 该字符的后一个字符不能是管道符
       * 3. 该字符的前一个字符不能是管道符
       * 4. 该字符不能处于括号之内
       */
      if (expression === undefined) {
        // first filter, end of expression
        lastFilterIndex = i + 1
        // 确认表达式，并且过滤空格
        expression = exp.slice(0, i).trim()
      } else {
        pushFilter()
      }
    } else {
      // 当不满足以上条件时，则会执行这里的代码
      switch (c) {
        case 0x22: inDouble = true; break         // "
        case 0x27: inSingle = true; break         // '
        case 0x60: inTemplateString = true; break // `
        case 0x28: paren++; break                 // (
        case 0x29: paren--; break                 // )
        case 0x5B: square++; break                // [
        case 0x5D: square--; break                // ]
        case 0x7B: curly++; break                 // {
        case 0x7D: curly--; break                 // }
      }
      // 正则环境处理
      if (c === 0x2f) { // /
        // j代表/字符的前一个字符的索引
        let j = i - 1
        let p
        // find first non-whitespace prev char
        // 找到/字符之前第一个不为空的字符，如果找不到说明/之前的所有字符都是空格，或根本就没有字符
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        // 如果之前有非空的字符，判断是否满足正则validDivisionCharRE，成立则认为当前字符/是正则的开始
        // 其实是很容易找到反例的，如 <div :key="a + /a/.test('abc')"></div> 实际是正则，但是Vue不认为是正则定义，因此失去意义
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }

  if (expression === undefined) {
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    pushFilter()
  }

  function pushFilter () {
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  // 判断绑定的值有没有过滤器，如果没有，那么整个字符串都会被当做为表达式的值，此时变量的filters为undifined
  if (filters) {
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i])
    }
  }

  return expression
}

function wrapFilter (exp: string, filter: string): string {
  // 过滤器函数是可以以函数调用的方式编写的，并且可以为其传递参数
  const i = filter.indexOf('(')
  if (i < 0) {
    // _f: resolveFilter
    // 如果不存在(，会返回字符串，如果filters是多个值的数组，且假设为['a', 'b']，最终完成的字符串将会是
    // '_f("b")(_f("a")(exp))'
    // _f函数的作用是接收一个过滤器函数的名字作为参数，然后找到相应的过滤器函数
    return `_f("${filter}")(${exp})`
  } else {
    const name = filter.slice(0, i)
    const args = filter.slice(i + 1)
    return `_f("${name}")(${exp}${args !== ')' ? ',' + args : args}`
  }
}
