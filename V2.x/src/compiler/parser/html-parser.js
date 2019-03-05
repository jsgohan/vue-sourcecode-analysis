/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson, Mozilla Public License
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'

// Regular Expressions for parsing tags and attributes
// 用来匹配标签的属性(attributes)
// 有五个捕获组
// 第一个捕获组用来匹配属性名
// 第二个捕获组用来匹配=号
// 第三、第四、第五个捕获组用来匹配属性值，同时最后的？表明第三、四、五个分组是可选的
// 在html标签中有4种属性值的方式：
//  1.使用双引号 class="some-class"
//  2.使用单引号 class='some-class'
//  3.不使用引号 class=some-class
//  4.单独的属性名 disabled
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// could use https://www.w3.org/TR/1999/REC-xml-names-19990114/#NT-QName
// but for Vue templates we can enforce a simple charset
// ncname全程是An XML name that does not contain a colon(:) 即不包含冒号的XML名称，也就是ncname就是不包含前缀的XML标签名称
const ncname = '[a-zA-Z_][\\w\\-\\.]*'
// qname就是合法的XML标签，即<前缀:标签名称>
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 用来匹配开始标签的一部分，包括<以及后面的标签名称
const startTagOpen = new RegExp(`^<${qnameCapture}`)
const startTagClose = /^\s*(\/?)>/
// 用来匹配结束标签，=
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
// 用来匹配文档的DOCTYPE标签，没有捕获组
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being pased as HTML comment when inlined in page
// 用来匹配注释节点，没有捕获组
const comment = /^<!\--/
// 用来匹配条件注释节点，没有捕获组
const conditionalComment = /^<!\[/

let IS_REGEX_CAPTURING_BROKEN = false
'x'.replace(/x(.)?/g, function (m, g) {
  IS_REGEX_CAPTURING_BROKEN = g === ''
})

// Special Elements (can contain anything)
// 检测给定的标签名字是不是纯文本标签
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

// decodingMap、encodedAttr、encodedAttrWithNewLines的作用是用来完成对HTML实体进行解码
const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t'
}
const encodedAttr = /&(?:lt|gt|quot|amp);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#10|#9);/g

// #5992
// 检测给定的标签是否是<pre>标签或者<textarea>标签
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
// shouldIgnoreFirstNewLine函数的作用是用来检测是否应该忽略元素内容的第一个换行符
// 即如pre标签和textarea会忽略其内容的第一个换行符，所以
// <pre>内容</pre>等价于
// <pre>
// 内容</pre>
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

// 用来解码html实体
// 利用正则encodedAttrWithNewLines和encodedAttr以及html实体与字符一一对应的decodingMap对象来实现将html实体转为对应的字符
function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

// 将html字符串作为字符流输入流，并且按照一定的规则将其逐步消化分解
export function parseHTML (html, options) {
  // 定义一些常量和变量
  // stack，在while循环中处理html字符流的时候每当遇到一个非一元标签，都会将该开始标签push到该数组
  // 用栈的方式处理标签问题，检测html字符串中是否缺少闭合标签
  const stack = []
  const expectHTML = options.expectHTML
  // 用来检测一个标签是否是一元标签
  const isUnaryTag = options.isUnaryTag || no
  // 用来检测一个标签是否是可以省略闭合标签的非一元标签
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // index标识当前字符流的读入位置，相对于原始html字符串
  // 变量last存储剩余还未parse的html字符串，变量lastTag始终存储着位于stack栈顶的元素
  let index = 0
  let last, lastTag
  // 开启一个while循环，循环结束的条件时html为空，即html被parse完毕
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 确保即将parse的内容不是在纯文本标签里(script、style、textarea)
      // textEnd的值是html字符串中左尖括号(<)第一次出现的位置
      let textEnd = html.indexOf('<')
      if (textEnd === 0) {
        // 左尖括号(<)开头的字符串可以是：
        // 1.可能是注释节点<!-- -->
        // 2.可能是条件注释节点<![ ]>
        // 3.可能是doctype<!DOCTYPE>
        // 4.可能是结束标签</xxx>
        // 5.可能是开始标签<xxx>
        // 6.可能只是一个单纯的字符串<abcdedg
        // Comment:
        // 条件为真，说明可能是注释节点，还要依赖于是不是以-->结尾
        if (comment.test(html)) {
          // 检查html字符串中-->的位置
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            // 如果为真则调用options.comment函数，并将注释节点的内容作为参数传递
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd))
            }
            // 将已经parse完毕的字符串剔除，调用advance函数
            advance(commentEnd + 3)
            // 开启下一次循环，重新开始parse过程
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            // 这里并没有像注释节点拥有parser选项的options.comment，所以Vue模板永远不会保留条件注释节点的内容
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // 其实，原则上Vue在编译的时候根本不会遇到Doctype标签
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length)
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(lastTag, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      // 例如字符串'< 2'，这个字符串虽然以<开头，但他什么标签都不是，这时将会进入另外一个if语句块的判断
      // 假设html = '0<1<2'
      // 此时textEnd的值应该为1
      if (textEnd >= 0) {
        // rest此时为<1<2
        rest = html.slice(textEnd)
        // 只有截取后的字符串不能匹配标签的情况下才会执行，这说明符号<存在于普通文本中
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          // 用于寻找下一个符号<的位置，并将位置索引存储在next变量中
          // <1<2，所以next值为2
          next = rest.indexOf('<', 1)
          if (next < 0) break
          textEnd += next
          // 将新的字符串赋值给rest，如此往复直到遇到一个能够成功匹配标签的<符号位置，或者当再也遇不到下一个<符号时，while循环会break
          rest = html.slice(textEnd)
        }
        text = html.substring(0, textEnd)
        advance(textEnd)
      }

      if (textEnd < 0) {
        text = html
        html = ''
      }

      // 字符串0<1会被作为普通字符串处理
      if (options.chars && text) {
        options.chars(text)
      }
    } else {
      // 即将parse的内容是在纯文本标签里(script，style，textare)
      // 当前正在处理的是纯文本标签里面的内容
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      // 该正则表达式包括两部分
      // 第一个分组 \s匹配空白符 \S匹配非空白符，由于二者同时存在于中括号中，所以它匹配的是二者的并集，也就是字符全集，使用了非贪婪模式，即只要第二个分组的内容找到匹配内容立即停止匹配。第一个分组的内容时用来匹配纯文本标签的内容
      // 第二个分组用来匹配纯文本标签的结束标签
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      // rest的作用是用来保存剩余的字符
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        // 将纯文本标签的内容全部作为纯文本对待
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 将整个字符串作为文本对待
    // 如果两者相等，则说明字符串html在经历循环体的代码之后没有任何改变，此时会把html字符串作为纯文本对待
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`)
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  // 接收一个Number类型的参数n，用html.substring(n)剔除已经parse完毕的字符串，同时更新index变量存储的字符流的读入位置，相对于原始html字符串
  function advance (n) {
    index += n
    html = html.substring(n)
  }

  // parseStartTag函数用来parse开始标签
  function parseStartTag () {
    const start = html.match(startTagOpen)
    // start的值为数组，如html为<div></div>，那么start的值应该为['<div', 'div']
    if (start) {
      // tagName的值为标签的名称
      // attrs用来存储将来被匹配到的属性
      // start当前字符流读入位置在整个html字符串中的相对位置
      const match = {
        tagName: start[1],
        attrs: [],
        start: index
      }
      advance(start[0].length)
      let end, attr
      // 循环条件为，一、没有匹配到开始标签的结束部分，二、匹配到了属性。直到遇到开始标签的结束部分为止
      while (!(end = html.match(startTagClose)) && (attr = html.match(attribute))) {
        // 如<div v-for="v in map"></div>
        // attr变量的值将为
        // attr = [
        //   ' v-for="v in map"',
        //   'v-for',
        //   '=',
        //   'v in map',
        //   undefined,
        //   undefined
        // ]
        // 调用advance，参数用attr[0].length即整个属性的长度
        advance(attr[0].length)
        // 将此次循环匹配到的结果push到定义的match对象的attrs数组中
        match.attrs.push(attr)
      }
      // 只有匹配到开始标签的结束部分，才说明这是一个完整的开始标签
      // 只有当变量end存在时，技能确定确实解析到了一个开始标签的时候parseStartTag函数才会有返回值，并且返回值是match对象，其他情况都返回undefined
      if (end) {
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  // handleStartTag函数用来处理parseStartTag的结果
  function handleStartTag (match) {
    const tagName = match.tagName
    // unarySlash的值为'/'或undefined
    const unarySlash = match.unarySlash

    if (expectHTML) {
      // 最近遇到的开始标签是p，并且当前正在解析的开始标签必须不能是段落式内容(Phrasing content)模型
      // 每一个html元素都拥有一个或多个内容模型(content model)，其中p标签本身的内容模型是流式内容(Flow content)，并且p标签的特性是只允许包含段落式内容(Phrasing content)
      // <p><h2></h2></p>
      // 在解析上面这段html字符串的时候，首先遇到p标签的开始标签，此时lastTag被设置为p，紧接着会遇到h2标签的开始标签，由于h2标签的内容模型属于非段落式内容模型
      // 所以会立即调用parseEndTag(lastTag)函数闭合p标签，此时前行插入了</p>标签，所以解析后的字符串将变为
      // <p></p><h2></h2></p>
      // 紧接着正常解析h2，最后解析器会遇到一个单独的p标签的结束标签即</p>，此时当解析器遇到p标签或br标签的结束标签时，会补全他们，最终会被解析为
      // <p></p><h2></h2><p></p>
      // 而这就是浏览器的行为
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      // 当前正在解析的标签是一个可以省略结束标签的标签，并且与上一次解析到的开始标签相同
      // 举例
      // <p>one
      // <p>two
      // 当解析到一个p标签的开始并且下一次遇到的标签也是p标签的开始标签时，会立即关闭第二个p标签
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }

    // unary是一个布尔值，当它为真时代表着标签是一元标签、否则是二元标签
    // 对于自定义组件，形式类似于<my-component />，由于并不存在与标准HTML所规定的一元标签之内
    // 所以此时还要使用第二个判断条件，即：开始标签的结束部分是否使用'/'，如果有，说明这是一个一元标签
    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs = new Array(l)
    // for循环用于格式化match.attrs数组，并将格式化后的数据存储到常量attrs中
    // 格式化包括两部分
    // 第一：格式化后的数据只包含name和value两个字符，其中name是属性名，value是属性的值
    // 第二：对属性值进行html实体的解码
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      // hackish work around FF bug https://bugzilla.mozilla.org/show_bug.cgi?id=369778
      // 解决旧版火狐浏览器bug，即当捕获组匹配不到值时捕获组对应变量的值应该是undefined而不是空字符串
      // 如果发现此时捕获到的属性值为空字符串那么就手动使用delete操作符将其删除
      if (IS_REGEX_CAPTURING_BROKEN && args[0].indexOf('""') === -1) {
        if (args[3] === '') { delete args[3] }
        if (args[4] === '') { delete args[4] }
        if (args[5] === '') { delete args[5] }
      }
      // 数组第4、5、6项其中之一可能会包含属性值，如果都没有获得到属性值，那么属性值将被设置为一个空字符串:''
      const value = args[3] || args[4] || args[5] || ''
      // shouldDecodeNewlines为true，意味着Vue在编译模板时要对属性值中的换行符或制表符做兼容处理
      // shouldDecodeNewlinesForHref为true，意味着Vue在编译模板时要对a标签的href属性值中的换行符或制表符做兼容处理
      // 举例
      // <div id="link-box">
      //   <!-- 注意href属性值，连接后加了一个换行 -->
      //   <a href="http://reyshieh.com
      //   ">aaaa</a>
      //   <!-- 注意href属性值，连接后面加了一个Tab -->
      //   <a href="http://reyshieh.com ">bbbb</a>
      // </div>
      // 这么写会有什么影响？
      // console.log(document.getElementById('link-box').innerHTML);
      // 获取的内容中换行符和制表符分别被转换成了&#10和&#9。这算是浏览器的怪癖行为。
      // 在IE中，不仅仅是a标签的href属性值，任何属性值都存在问题。
      // 这回影响Vue的编译器在对模板进行编译后的结果，导致莫名其妙的问题
      // 为了要做兼容工作，这就是这两个变量的作用
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      // decodeAttr函数的作用是对属性值中所包含的html实体进行解码，将其转换为实体对应的字符
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
    }

    // 判断条件时当开始标签是非一元标签时才会执行，目的是
    // 如果开始标签是非一元标签，则将该开始标签的信息入栈，即push到stack数组中，并将lastTag的值设置为该标签
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs })
      lastTag = tagName
    }

    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  // parseEndTag函数用来parse结束标签
  // 作用包括：
  // 第一，在标签中缺少了结束标签的情况如 <article><div></article>，缺少</div>，此时应该给用户一个提示
  // 第二，函数还可以处理stack栈中剩余未被处理的标签 如 <article><div></div></article><div> 此时stack最后会剩余一个div的值
  // 第三，函数专门处理br与p的结束标签，在浏览器的行为中，只写</br>和</p>会默认解析为<br>和<p></p>，就是为了保持和浏览器的行为一致
  function parseEndTag (tagName, start, end) {
    // pos会在后面用于判断html字符串是否缺少结束标签
    // lowerCasedTagName变量用来存储tagName的小写版
    let pos, lowerCasedTagName
    // start和end不存在时，将这两个变量的值设置为当前字符流的读入位置，即index
    if (start == null) start = index
    if (end == null) end = index

    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
    }

    // Find the closest opened tag of the same type
    // 寻找当前解析的结束标签所对应的开始标签在stack栈中的位置，并将对应的位置保存到pos变量中，如果tagName不存在，则直接将pos设置为0
    // pos用来判断是否有元素缺少闭合标签
    if (tagName) {
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    if (pos >= 0) {
      // Close all the open elements, up the stack
      // 如果发现stack数组中存在索引大于pos的元素，那么该元素一定是缺少闭合标签的
      // 在非生产环境Vue会打印警告，告诉缺少闭合标签，随后会调用options.end()立即将其闭合，这是为了保证解析结果的正确性
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`
          )
        }
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      // 最后更新stack栈以及lastTag
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
    }
    // 当tagName没有在stack栈中找到对应的开始标签时，pos为-1
    // 但只有对br和p标签才有处理，如为</div>浏览器会将其忽略，Vue的parser与浏览器的行为一致
    else if (lowerCasedTagName === 'br') {
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
