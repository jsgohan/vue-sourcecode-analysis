/* @flow */

import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'
import VNode from '../vdom/vnode'

const seenObjects = new Set()

/**
 * Recursively traverse an object to evoke all converted
 * getters, so that every nested property inside the object
 * is collected as a "deep" dependency.
 */
export function traverse (val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}

function _traverse (val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  // 当被检查的属性的值不是对象，数组，或该值是冻结的，或是VNode实例，就返回
  if ((!isA && !isObject(val)) || Object.isFrozen(val) || val instanceof VNode) {
    return
  }
  // 解决循环引用导致死循环的问题
  if (val.__ob__) {
    // 如果一个响应式数据是对象或数组，那么会包含一个__ob__的属性，这时读取val.__ob__.dep.id作为一个唯一的ID值
    // 并将它放到seenObjects中，这样就不会出现已经遍历过的对象还会再被引用，解决循环引用的对象问题
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }
  if (isA) {
    i = val.length
    // 实际作用是读取子属性的值，这就会触发子属性的get拦截器函数，保证子属性能够收集到观察者
    while (i--) _traverse(val[i], seen)
  } else {
    keys = Object.keys(val)
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}
