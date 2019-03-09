/* @flow */

// 该函数是一个解析器，作用是将模板字符串解析为对应的抽象语法树(AST)
// 有了AST后就可以根据这个AST生成不同平台的目标代码
// 分为三个阶段：词法分析->句法分析->代码生成（在codegen/index.js的generate函数中执行）
// 词法分析阶段Vue把字符串模板解析成一个个的令牌(token)，该令牌将用于句法分析阶段
// 句法分析阶段会根据令牌生成一棵AST
// 最后根据AST生成最终的渲染函数
// parse: 解析 parser: 解析器
import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  pluckModuleFunction
} from '../helpers'

// 用于检测标签属性名是否是监听事件的指令
export const onRE = /^@|^v-on:/
// 检测标签属性名是否是指令
export const dirRE = /^v-|^@|^:/
// 检测v-for属性的值，并捕获in 或of前后的字符串
export const forAliasRE = /([^]*?)\s+(?:in|of)\s+([^]*)/
// 用于捕获<div v-for="(obj, index) of list"></div>和<div v-for="(obj, key, index) in object"></div>类型的v-for中前者括号中的内容
// 先由forAliasRE 第一个捕获组的内容为字符串'(obj, index)' 再由forIteratorRE正则的第一个捕获组捕获到字符串index，第二个没有内容
// '(obj, key, index)' 第一个捕获组为key 第二个捕获组为index
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
// 作用是捕获要么以(开头，要么以)结尾的字符串，在上面提到的'(obj, key, index)' 就要先去掉( )以后再进行正则匹配
const stripParensRE = /^\(|\)$/g

// 用于匹配指令中的参数
const argRE = /:(.*)$/
// 检测标签的属性是否是绑定(v-bind)
export const bindRE = /^:|^v-bind:/
// 用来匹配修饰符
const modifierRE = /\.[^.]+/g

// cached函数的作用是接收一个函数作为参数并返回一个新的函数，新函数的功能与作为参数传递的函数功能相同，唯一不同的是新函数具有缓存值的功能
// 如果一个函数在接收相同参数的情况下所返回的值总是相同的，那么cached函数将会为 该函数提供性能的优势
// he是第三方的库，he.decode函数用于HTML字符实体的解码工作
// he.decode('&#x26;') // => &
const decodeHTMLCached = cached(he.decode)

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace

type Attr = { name: string; value: string };

// 该函数用来创建一个元素的描述对象，这样在创建元素描述对象时就不需要手动编写对象字面量了，方便的同时还能提高代码整洁性
// 接收三个参数，分别是标签名字tag，该标签拥有的属性数组attrs以及该标签的父标签描述对象的引用
// 比如<div v-for="obj of list" class="box"></div>
// 只需传递两个参数，tag、attrs，即可创建该div标签的描述对象
// element = {
//   type: 1,
//   tag: 'div',
//   attrsList: [{
//     name: 'v-for',
//     value: 'obj of list'
//   }, {
//     name: 'class',
//     value: 'box'
//   }],
//   attrsMap: makeAttrsMap(attrs),
//   parent,
//   children: []
// }
export function createASTElement (
  tag: string,
  attrs: Array<Attr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 * parse函数的作用是在词法分析的基础上做句法分析从而生成一棵AST
 */
export function parse (
  template: string,
  options: CompilerOptions
): ASTElement | void {
  warn = options.warn || baseWarn

  // 判断标签是否是pre标签
  platformIsPreTag = options.isPreTag || no
  // 作用是用来监测一个属性在标签中是否使用props进行绑定
  platformMustUseProp = options.mustUseProp || no
  // 作用是获取元素(标签)的命名空间
  platformGetTagNamespace = options.getTagNamespace || no

  transforms = pluckModuleFunction(options.modules, 'transformNode')
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  // 实际在options.modules中并没有postTransformNode函数，所以最终postTransforms变量的值将是一个空数组
  // preTransforms = []
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  // Vue实例对象时传递的选项，是一个数组
  delimiters = options.delimiters

  // 思路和创建AST思路使用的stack数组是一致的，作用是用来修正当前正在解析元素的父级
  const stack = []
  // 布尔值，并且值与编译器选项中的options.preserveWhitespace有关，只要不为false，就为true
  // preserceWhitespace用来告诉编译器在编译html字符串时是否放弃标签之间的空格，如果为true则代表放弃
  const preserveWhitespace = options.preserveWhitespace !== false
  // root变量为parse函数的返回值，即最终的AST
  let root
  // 元素描述对象之间的父子关系就是靠该变量进行联系
  let currentParent
  // inVPre变量用来标识当前解析的标签是否在拥有v-pre的标签之内
  let inVPre = false
  // inPre变量用来标识当前正在解析的标签是否在<pre></pre>标签之内
  let inPre = false
  let warned = false

  function warnOnce (msg) {
    if (!warned) {
      warned = true
      warn(msg)
    }
  }

  // 每当遇到一个标签的结束标签时，或遇到一元标签时都会调用该方法"闭合"标签
  function closeElement (element) {
    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  // 主要通过调用parseHTML函数对模板字符串进行解析
  // parseHTML函数的作用就是用来做词法分析的
  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    // start钩子函数，在解析html字符串时每次遇到开始标签时就会调用该函数
    start (tag, attrs, unary) {
      // check namespace.
      // inherit parent ns if there is one
      // 检查当前元素的命名空间，何如获取？首先检查currentParent，如果存在命名空间，就使用这个命名空间，否则使用platformGetTagNamespace获取当前命名空间
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      // 如果当前宿主环境是IE浏览器且命名空间为svg，就会调用guardIESVGBug函数处理当前元素的属性数组attrs，并重新赋值
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 为当前元素创建描述对象，并且元素描述对象的创建时通过createASTElement完成
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      // 检查是否有ns属性，其值为命名空间的值
      if (ns) {
        element.ns = ns
      }

      // 判断非服务端渲染情况下，当前元素是否是禁止在模板中使用的标签
      // style和script都是被认为禁止的标签，因为Vue认为模板应该只负责做数据状态到UI的映射，而不应该存在引起副作用的代码
      // 如果模板中存在<script>标签，那么标签内的diamante很容易引起副作用
      // 例如
      // <script type="text/x-template" id="hello-world-template">
      //   <p>Hello</p>
      // </script>
      // 这段script添加了type="text/x-template"属性，Vue并不会禁止，可以查看isForbiddenTag函数
      if (isForbiddenTag(element) && !isServerRendering()) {
        // 如果是禁止的，会在当前元素的描述对象上添加el.forbidden属性，设置为true
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.'
        )
      }

      // apply pre-transforms
      // preTran.sforms是通过pluckModuleFunction函数从options.modules选项中选出名字为preTransformNode函数所组成的数组
      for (let i = 0; i < preTransforms.length; i++) {
        // preTransforms数组中的函数的作用，本质上这些函数的作用与process*系列的函数没什么却别，都是用来对当前元素描述对象做进一步处理
        // transforms和postTransforms数组也是一样，它们之间的区别就是根据不同的调用时机为它们定义相应的名字
        // 为什么把他们区分出来？这是为了平台化的考虑，这三个数组中的函数都是放在web平台中使用的，除了web平台之外也可以看到weex平台下响应的代码
        element = preTransforms[i](element, options) || element
      }

      if (!inVPre) {
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }
      if (platformIsPreTag(element.tag)) {
        // 判断当前标签是否在<pre>标签内，pre标签内的解析行为与其他标签是不同的。
        // 具体为：
        // 1. <pre>标签会对其所包含的html字符实体进行解码
        // 2. <pre>标签会保留html字符串编写时的空白
        inPre = true
      }
      if (inVPre) {
        // 使用v-pre指令的标签及其子标签的解析行为是不一致的，编译器会跳过使用了v-pre指令元素及其子元素的编译工作
        processRawAttrs(element)
      } else if (!element.processed) {
        // processed表示当前元素是否已经被解析过，是在preTransforms数组中的处理函数时被添加的
        // structural directives
        processFor(element)
        // 用来处理那些使用了条件指令的标签的元素描述对象
        // 条件的指令指的是v-if、v-else-if、v-else三个指令
        processIf(element)
        // 处理v-once指令的标签
        processOnce(element)
        // element-scope stuff
        // 一系列process*函数的集合
        processElement(element, options)
      }

      // 作用是用来检测模板根元素是否符合要求，
      // 在编写Vue模板的时候会受到两种约束，首先模板必须有且仅有一个被渲染的根元素，第二不能使用slot标签和template标签作为模板的根元素
      // slot作为插槽，它的内容时由外界决定的，而插槽的内容很有可能渲染多个节点
      // template元素的内容虽然不是由外界决定的，但它本身作为抽象组件是不会渲染任何内容到页面的
      // 这些限制的原因只有一个 必须有且仅有一个根元素
      function checkRootConstraints (el) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.tag === 'slot' || el.tag === 'template') {
            warnOnce(
              `Cannot use <${el.tag}> as component root element because it may ` +
              'contain multiple nodes.'
            )
          }
          if (el.attrsMap.hasOwnProperty('v-for')) {
            warnOnce(
              'Cannot use v-for on stateful component root element because ' +
              'it renders multiple elements.'
            )
          }
        }
      }

      // tree management
      // root变量不存在，说明当前元素应该就是根元素，所以在if语句块内直接将当前元素的描述对象element赋值给root变量
      if (!root) {
        root = element
        checkRootConstraints(root)
      } else if (!stack.length) {
        // allow root elements with v-if, v-else-if and v-else
        // 如果stack数组为空并且当前正在解析开始标签，说明了什么？正常情况下当stack被清空后则说明整个模板字符串已经解析完毕了，但此时start钩子函数仍然被调用，说明模板中存在多个根元素，这时elseif语句块内的代码将被执行
        // Vue模板约束是必须有且仅有一个被渲染的根元素，但可以定义多个根元素，只要能够保证最终只会渲染其中一个元素即可
        // 能够达到这个目的的方式只有一种，那就是在多个根元素之间使用v-if或v-else-if或v-else
        // 这些描述都是通过processIf函数处理元素描述对象时，发现元素的属性中有v-if或v-else-if或v-else，就会添加响应的属性作为标识
        // root为第一个根元素的描述对象，element为当前元素描述对象，即非第一个根元素的描述对象
        // 如果条件成立就能够保证所有根元素都是由v-if、v-else-if、v-else等指令控制的
        // 间接保证了被渲染的根元素只有一个
        // 举例
        // <div v-if="a"></div>
        // <p v-else-if="b"></p>
        // <span v-else></span>
        // 简化版AST为
        // {
        //   type: 1,
        //   tag: 'div',
        //   ifConditions: [{
        //     exp: 'b',
        //     block: { type: 1, tag: 'p', 其他}
        //   }, {
        //     exp: undefined,
        //     block: { type: 1, tag: 'span', 其他}
        //   }]
        // }
        // 其实带有v-if属性的元素也会将自身的元素描述对象添加到自身的.ifConditions数组中
        if (root.if && (element.elseif || element.else)) {
          checkRootConstraints(element)
          addIfCondition(root, {
            exp: element.elseif,
            block: element
          })
        } else if (process.env.NODE_ENV !== 'production') {
          warnOnce(
            `Component template should contain exactly one root element. ` +
            `If you are using v-if on multiple elements, ` +
            `use v-else-if to chain them instead.`
          )
        }
      }
      // 存在父级且当前元素不是被禁止的元素
      if (currentParent && !element.forbidden) {
        if (element.elseif || element.else) {
          // 如果一个标签使用v-else-if或v-else指令，那么该元素的描述对象实际上会被添加到对应的v-if元素描述对象的ifConditions数组中，而不是作为一个独立的子节点
          processIfConditions(element, currentParent)
        } else if (element.slotScope) { // scoped slot
          // 如果一个元素使用slot-scope特性，该元素的描述对象会被添加到父级元素的scopedSlots对象下
          // 这点和v-else-if或v-else指令的元素一样
          currentParent.plain = false
          const name = element.slotTarget || '"default"'
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        } else {
          currentParent.children.push(element)
          element.parent = currentParent
        }
      }
      // 检测当前元素是否是非一元标签
      if (!unary) {
        // 是非一元标签，就添加到stack栈中，并且将currentParent变量的值更新为当前元素的描述对象
        currentParent = element
        stack.push(element)
      } else {
        // 是一元标签，调用closeElement函数闭合该元素
        closeElement(element)
      }
    },
    // end钩子函数，在解析html字符串时每次遇到结束标签时就会调用该函数
    end () {
      // remove trailing whitespace
      const element = stack[stack.length - 1]
      const lastNode = element.children[element.children.length - 1]
      if (lastNode && lastNode.type === 3 && lastNode.text === ' ' && !inPre) {
        element.children.pop()
      }
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      closeElement(element)
    },
    // chars钩子函数，在解析html字符串时每次遇到纯文本时就会调用该函数
    chars (text: string) {
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.'
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      text = inPre || text.trim()
        ? isTextTag(currentParent) ? text : decodeHTMLCached(text)
        // only preserve whitespace if its not right after a starting tag
        : preserveWhitespace && children.length ? ' ' : ''
      if (text) {
        let res
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          children.push({
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          })
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          children.push({
            type: 3,
            text
          })
        }
      }
    },
    // comment钩子函数，在解析html字符串时每次遇到注释节点时就会调用该函数
    comment (text: string) {
      currentParent.children.push({
        type: 3,
        text,
        isComment: true
      })
    }
  })
  return root
}

// 以下所有方法中的el实际上就是元素的描述对象
// el = {
//   type: 1,
//   tag,
//   attrsList: attrs,
//   attrsMap: makeAttrsMap(attrs),
//   parent,
//   children: []
// }
// process*系列函数的作用就是对元素描述对象做进一步处理，且这些函数都会用在parseHTML函数的钩子选项函数中
// 非process*系列函数如findPrevElement、makeAttrsMap等，实际上都是工具函数

/**
 * 接收元素描述对象作为参数
 */
function processPre (el) {
  // 获取给定元素的某个属性的值
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

/**
 * 接收元素描述对象作为参数，作用是将该元素所有属性全部作为原生的属性(attr)处理
 */
function processRawAttrs (el) {
  const l = el.attrsList.length
  if (l) {
    const attrs = el.attrs = new Array(l)
    for (let i = 0; i < l; i++) {
      attrs[i] = {
        name: el.attrsList[i].name,
        // 实际el.attrsList[i].value本身就已经是一个字符串了，在字符串的基础上继续JSON.stringify，
        // 举例
        // const fn1 = new Function('console.log(1)');
        // const fn2 = new Function(JSON.stringify('console.log(1)'));
        // 等价于
        // const fn1 = function() {
        //   console.log(1);
        // };
        // const fn2 = function() {
        //   'console.log(1)';
        // };
        // 可以看到fn1函数的执行能够通过console.log语句打印数字1，而fn2函数体内的console.log语句是一个字符串
        // 因此这里使用JSON.stringify实际上就是保证最终生成的代码中el.attrsList[i].value属性始终被作为普通的字符串处理
        value: JSON.stringify(el.attrsList[i].value)
      }
    }
  } else if (!el.pre) {
    // 如果一个标签没有任何属性，并且该标签是使用了v-pre指令标签的子代标签，那么该标签的元素描述对象将被添加element.plain属性，并且其值为true
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

export function processElement (element: ASTElement, options: CompilerOptions) {
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // 判断元素描述对象的key属性是否存在，同时检查元素描述符对象的attrsList数组是否为空
  // 只要，当标签没有使用key属性并且标签只使用了结构化指令(包括v-for、v-if/v-else-if/v-else、v-once)的情况才被认为是"纯"的
  element.plain = !element.key && !element.attrsList.length

  processRef(element)
  processSlot(element)
  processComponent(element)
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  processAttrs(element)
}

/**
 * 对于该函数的理解举例
 * 例1
 * <div key="id"></div>
 * 此时el.key = JSON.stringify('id')
 * 例2
 * <div :key="id"></div>
 * 此时el.key = 'id'
 * 例3
 * <div :key="id | featId"></div>
 * 此时el.key = '_f("featId")(id)'
 */
function processKey (el) {
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    // 提示template标签是不需要使用key属性的
    if (process.env.NODE_ENV !== 'production' && el.tag === 'template') {
      warn(`<template> cannot be keyed. Place the key on real elements instead.`)
    }
    el.key = exp
  }
}

function processRef (el) {
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    // 判断使用了ref属性的标签是否存在于v-for指令之内
    // 如果ref属性存在于v-for指令之内，需要创建一个组件实例或DOM节点的引用数组，而不是单一引用这个时候就需要el.refInFor属性来区分了
    el.refInFor = checkInFor(el)
  }
}

export function processFor (el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

/**
 * 函数接收v-for指令的值作为参数，解析字符串
 */
export function parseFor (exp: string): ?ForParseResult {
  // 以obj in list为例
  // inMatch常量为
  // const inMatch = [
  //   'obj in list',
  //   'obj',
  //   'list'
  // ]
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  // res.for属性所存储的值是被遍历的目标变量的名字
  res.for = inMatch[2].trim()
  // 移除inMatch[1]中的左右圆括号和空格
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  // 如果alias字符串的值为'obj'，则匹配结果iteratorMatch常量的值为null
  // 如果是'obj, index'，则结果为包含两个元素的数组[', index', 'index']
  // 如果是'obj, key, index'，则结果是[', key, index', 'key', 'index']
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '')
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

function processIf (el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    el.if = exp
    // 这里就是解释了上面提到的ifConfidtions数组是包含自己的，在最开始的时候就添加该值记录了
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions (el, parent) {
  // 通过findPrevElement函数找到当前元素的前一个元素描述对象，并将其赋值给prev常量
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`
    )
  }
}

/**
 * 寻找当前元素的前一个元素节点
 * 举例
 * <div>
 *  <div v-if="a"></div>
 *  <p v-else-if="b"></p>
 *  <span v-else="c"></span>
 * </div>
 * 要想得到div标签，只要找父级元素描述对象的children数组最后一个元素即可
 */
function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    // 1代表元素节点，只有是元素节点才会将节点的描述对象作为返回值返回
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`
        )
      }
      children.pop()
    }
  }
}

// condition类型为ASTIfCondition，包含两个属性： 分别是exp和block
// exp为当前元素描述对象的element.elseif的值
// block为当前元素描述对象
export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

function processOnce (el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

function processSlot (el) {
  // 处理<slot>插槽标签，如<slot name="header"></slot>
  if (el.tag === 'slot') {
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`
      )
    }
  } else {
    let slotScope
    if (el.tag === 'template') {
      // 调用getAndRemoveAttr函数，说明scope属性和slot-scope属性是不能写成绑定的属性的
      // <div :slot-scope="slotProps" ></div>是错误的代码
      slotScope = getAndRemoveAttr(el, 'scope')
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && slotScope) {
        warn(
          `the "scope" attribute for scoped slots have been deprecated and ` +
          `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
          `can also be used on plain elements in addition to <template> to ` +
          `denote scoped slots.`,
          true
        )
      }
      el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
    } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
      /* istanbul ignore if */
      // <div slot-scope="slotProps" v-for="item of slotProps.list"></div>
      // v-for具有更高的优先级，所以v-for绑定的状态将会是父组件作用域的状态，而不是子组件通过作用域插槽传递的状态
      // 更好：的使用方式应该是如下
      // <template slot-scope="slotProps">
      //  <div v-for="item of slotProps.list"></div>
      // </template>
      // v-for绑定的状态就是作用域插槽传递的状态
      if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
        warn(
          `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
          `(v-for takes higher priority). Use a wrapper <template> for the ` +
          `scoped slot to make it clearer.`,
          true
        )
      }
      el.slotScope = slotScope
    }
    // 使用getBindingAttr函数，意味着slot属性时可以绑定的
    const slotTarget = getBindingAttr(el, 'slot')
    if (slotTarget) {
      el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
      // preserve slot as an attribute for native shadow DOM compat
      // only for non-scoped slots.
      if (el.tag !== 'template' && !el.slotScope) {
        addAttr(el, 'slot', slotTarget)
      }
    }
  }
}

// Vue内置了component组件，并且该组件接收两个prop分别是：is和inline-template
function processComponent (el) {
  let binding
  // 获取元素is属性值得到的，如果获取成功，则会将渠道的值赋值给元素描述对象的el.component属性
  // 举例
  // 例1 <div is></div> el.component属性值为空字符串
  // 例2 <div is="child"></div> el.component = JSON.stringify('child')
  // 例3 <div :is="child"></div> el.component = 'child'
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

function processAttrs (el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, isProp
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    if (dirRE.test(name)) {
      // mark element as dynamic
      el.hasBindings = true
      // modifiers
      modifiers = parseModifiers(name)
      if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind
        name = name.replace(bindRE, '')
        value = parseFilters(value)
        isProp = false
        if (modifiers) {
          if (modifiers.prop) {
            isProp = true
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel) {
            name = camelize(name)
          }
          if (modifiers.sync) {
            addHandler(
              el,
              `update:${camelize(name)}`,
              genAssignmentCode(value, `$event`)
            )
          }
        }
        if (isProp || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          addProp(el, name, value)
        } else {
          addAttr(el, name, value)
        }
      } else if (onRE.test(name)) { // v-on
        name = name.replace(onRE, '')
        addHandler(el, name, value, modifiers, false, warn)
      } else { // normal directives
        name = name.replace(dirRE, '')
        // parse arg
        const argMatch = name.match(argRE)
        const arg = argMatch && argMatch[1]
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
        }
        addDirective(el, name, rawName, value, arg, modifiers)
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.'
          )
        }
      }
      addAttr(el, name, JSON.stringify(value))
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
          name === 'muted' &&
          platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true')
      }
    }
  }
}

function checkInFor (el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers (name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

/**
 * 将标签的属性数组转换成名值对--对象的对象
 */
function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name)
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

function checkForAliasModel (el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`
      )
    }
    _el = _el.parent
  }
}
