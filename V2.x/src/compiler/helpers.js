/* @flow */

import { emptyObject } from 'shared/util'
import { parseFilters } from './parser/filter-parser'

export function baseWarn (msg: string) {
  console.error(`[Vue compiler]: ${msg}`)
}

// 该函数的作用是从第一个参数中"采摘"出函数名字与第二个参数所指定字符串相同的函数，并将它们组成一个数组
export function pluckModuleFunction<F: Function> (
  modules: ?Array<Object>,
  key: string
): Array<F> {
  return modules
    ? modules.map(m => m[key]).filter(_ => _)
    : []
}

export function addProp (el: ASTElement, name: string, value: string) {
  (el.props || (el.props = [])).push({ name, value })
  el.plain = false
}

export function addAttr (el: ASTElement, name: string, value: any) {
  (el.attrs || (el.attrs = [])).push({ name, value })
  el.plain = false
}

// add a raw attr (use this in preTransforms)
export function addRawAttr (el: ASTElement, name: string, value: any) {
  el.attrsMap[name] = value
  el.attrsList.push({ name, value })
}

export function addDirective (
  el: ASTElement,
  name: string,
  rawName: string,
  value: string,
  arg: ?string,
  modifiers: ?ASTModifiers
) {
  (el.directives || (el.directives = [])).push({ name, rawName, value, arg, modifiers })
  el.plain = false
}

/**
 * 
 * @param {*} el 当前元素描述对象
 * @param {*} name 绑定属性的名字，即事件名称
 * @param {*} value 绑定属性的值，这个值可能是事件回调函数名字，有可能是内联语句，有可能是函数表达式
 * @param {*} modifiers 指令对象
 * @param {*} important 可选参数，布尔值，代表着天剑的事件侦听函数的重要级别
 * @param {*} warn 
 */
export function addHandler (
  el: ASTElement,
  name: string,
  value: string,
  modifiers: ?ASTModifiers,
  important?: boolean,
  warn?: Function
) {
  modifiers = modifiers || emptyObject
  // warn prevent and passive modifier
  /* istanbul ignore if */
  if (
    process.env.NODE_ENV !== 'production' && warn &&
    modifiers.prevent && modifiers.passive
  ) {
    warn(
      'passive and prevent can\'t be used together. ' +
      'Passive handler can\'t prevent default event.'
    )
  }

  // check capture modifier
  if (modifiers.capture) {
    delete modifiers.capture
    // 例如<div @click.capture="handleClick"></div> 实际name改为了!click
    name = '!' + name // mark the event as captured
  }
  if (modifiers.once) {
    delete modifiers.once
    name = '~' + name // mark the event as once
  }
  /* istanbul ignore if */
  if (modifiers.passive) {
    delete modifiers.passive
    name = '&' + name // mark the event as passive
  }

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  // 注意，如果事件绑定了once修饰符，则名字被改为~click，不会等于'click'，所以同时使用once修饰符和right修饰符，点击事件不会被触发
  // <div @click.right.once="handleClickRightOnce"></div>
  // 可以改为 <div @contextmenu.once="handleClickRightOnce"></div>
  if (name === 'click') {
    if (modifiers.right) {
      name = 'contextmenu'
      delete modifiers.right
    } else if (modifiers.middle) {
      name = 'mouseup'
    }
  }

  let events
  if (modifiers.native) {
    delete modifiers.native
    events = el.nativeEvents || (el.nativeEvents = {})
  } else {
    events = el.events || (el.events = {})
  }

  const newHandler: any = {
    value: value.trim()
  }
  if (modifiers !== emptyObject) {
    newHandler.modifiers = modifiers
  }

  const handlers = events[name]
  /* istanbul ignore if */
  if (Array.isArray(handlers)) {
    // 这里就是同样的事件绑定了三次以上会调用的
    important ? handlers.unshift(newHandler) : handlers.push(newHandler)
  } else if (handlers) {
    // 举例 <div @click.prevent="handleclick1" @click="handleclick2"></div>
    // 定义了两个click事件的侦听，因为两个事件的名称是相同的，会调用两次addHandle函数
    // 第一次调用时，el.events赋值完，即调用的是else里
    // el.events = {
    //   click: {
    //     value: 'handleclick1',
    //     modifiers: { prevent: false }
    //   }
    // }
    // 第二次调用，会走这个操作，此时important会影响被添加的handlers对象的顺序，最终会变成一个数组
    // el.events = {
    //   click: [{
    //     value: 'handleclick1',
    //     modifiers: { prevent: false }
    //   }, {
    //     value: 'handleclick2'
    //   }]
    // }
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler]
  } else {
    // 举例 <div @click.once="handleclick"></div>
    // newHandler对象应该是：
    // newHandler = {
    //   value: 'handleclick',
    //   modifiers: {}
    // }
    // 所以最终events为
    // el.events = {
    //   '~click' : {
    //     value: 'handleclick',
    //     modifiers: {}
    //   }
    // }
    events[name] = newHandler
  }

  el.plain = false
}

export function getBindingAttr (
  el: ASTElement,
  name: string,
  getStatic?: boolean
): ?string {
  // 用getAndRemoveAttr获取名字为 ':' + name 或 'v-bind:' + name的属性值赋值给常量
  const dynamicValue =
    getAndRemoveAttr(el, ':' + name) ||
    getAndRemoveAttr(el, 'v-bind:' + name)
  if (dynamicValue != null) {
    // 此时需要解析过滤器，并将处理后的值作为最终的返回结果
    return parseFilters(dynamicValue)
  } else if (getStatic !== false) {
    // 还存在一种不带: 或v-bind: 的情况，即传递给函数的第二个参数是原始的属性名字，并保存在staticValue常量中
    const staticValue = getAndRemoveAttr(el, name)
    if (staticValue != null) {
      // 保证返回的就是字符串
      return JSON.stringify(staticValue)
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
/**
 * el为元素描述对象
 * name获取属性的名字
 * removeFromMap可选，布尔值
 * 举例
 * <div v-if="display"></div>
 * element = {
 *  type: 1,
 *  tag: 'div',
 *  attrsList: [{
 *    name: 'v-if',
 *    value: 'display'
 *  }],
 *  attrsMap: {
 *    'v-if': 'display'
 *  }
 * }
 * 该函数返回的值为字符串'display'，同时会将v-if属性从attrsList数组中移除，所以处理后变为：
 * element = {
 *  type: 1,
 *  tag: 'div',
 *  attrsList: [],
 *  attrsMap: {
 *    'v-if': 'display'
 *  }
 * }
 * 如果removeFromMap为true，getAndRemoveAttr(element, 'v-if', true)
 * element = {
 *  type: 1,
 *  tag: 'div',
 *  attrsList: [],
 *  attrsMap: {}
 * }
 */
export function getAndRemoveAttr (
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): ?string {
  let val
  if ((val = el.attrsMap[name]) != null) {
    // 目的是找到元素使用数组的splice方法将该数组元素从元素描述对象的attrsList数组中移除
    const list = el.attrsList
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        list.splice(i, 1)
        break
      }
    }
  }
  // 如果为true，还会将该属性从属性名值表(attrsMap)中移除
  if (removeFromMap) {
    delete el.attrsMap[name]
  }
  return val
}
