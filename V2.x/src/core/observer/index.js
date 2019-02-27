/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that has this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    // 使用def函数，为数据对象定义一个__ob__属性，属性值为当前Observer实例对象
    // def函数其实就是Object.defineProperty函数的简单封装
    // 之所以这里使用def函数定义__ob__属性是因为这样可以定义不可枚举的属性，这样后面遍历数据对象的时候就能够防止遍历到__ob__属性
    // 举例：
    // const data = {
    //   a: 1
    // }
    // def函数处理之后
    // const data = {
    //   a: 1,
    //   // __ob__是不可枚举的属性
    //   __ob__: {
    //     value: data, // value属性指向data数据对象本身，是一个循环引用
    //     dep: dep实例对象, // new Dep()
    //     vmCount: 0
    //   }
    // }
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      const augment = hasProto
        ? protoAugment
        : copyAugment
      augment(value, arrayMethods, arrayKeys)
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through each property and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment an target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object, keys: any) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment an target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 * asRootData代表将要被观测的数据是否是根级数据
 * obserse使用的是观察者模式
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 用来判断如果要观测的数据不是一个对象或者是VNode实例，则直接return
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  // __ob__是什么？当一个数据对象被观测之后将会在该对象上定义__ob__属性，if分支的作用是用来避免重复观测一个数据对象
  // 能看到享元模式的影子
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    // 需要满足的条件
    // 1. shouldObserve为true，代表开关，在一些场景下需要这个开关从而达到一些目的
    // 2. !isServerRendering() 判断是否是服务端渲染。只有不是服务端渲染的时候才会观测数据
    // 3. (Array.isArray(value) || isPlainObject(value)) 只有当数据对象是数组或纯对象时，才有必要对其进行观测
    // 4. Object.isExtensible(value) 被观测的数据对象必须是可扩展的。一个普通对象默认是可扩展的，可以将对象变得不可扩展通过以下三种方式：
    //    a. Object.preventExtensions()
    //    b. Object.freeze()
    //    c. Object.seal()
    // 5. !value._isVue 为true，Vue实例对象拥有_isVue属性，该条件用来避免Vue实例对象被观测
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 * defineReactive函数的核心就是将数据对象的数据属性转换为访问器属性
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 每一个数据字段都通过闭包引用着属于自己的dep常量
  const dep = new Dep()

  // Object.getOwnPropertyDescriptor函数获取该字段可能已有的属性描述对象
  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 不可配置的属性是没有必要使用Object.defineProperty改变其属性定义的
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 因为接下来会使用Object.defineProperty函数重新定义属性的setter/getter，这回导致属性原有的set和get方法被覆盖
  // 所以将属性原有的setter/getter缓存，并在重新定义的set和get方法中调用缓存的函数，不影响属性的原有读写操作
  // 该处使用了适配器模式
  const getter = property && property.get
  const setter = property && property.set
  // 当属性原本存在get拦截器函数时，在初始化的时候不要出发get函数，只有当真正的获取该属性的值的时候，再通过调用缓存下来的属性原本的getter函数取值即可
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // 获取到的val本身可能也是一个对象，那么此时应该继续调用observe(val)函数观测该对象从而深度观测数据对象
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // get函数做两件事：正确地返回属性值以及收集依赖
    get: function reactiveGetter () {
      // 第一件事，正确地返回属性值
      const value = getter ? getter.call(obj) : val
      // 第二件事，收集依赖
      // target作用是保存要被收集的依赖(观察者)
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          // 举例
          // const data = {
          //   a: {
          //     b: 1
          //   }
          // }
          // const data = {
          //   a: {
          //     b: 1,
          //     __ob__: {value, dep, vmCount}
          //   },
          //   __ob__: {value, dep, vmCount}
          // }
          // 可知，childOb === data.a.__ob__
          // 所以childOb.dep === data.a__ob__.dep
          // 也就是说childOb.dep.depend()执行说明除了要将依赖收集到属性a之外，还要将同样的依赖收集到data.a.__ob__.dep
          // 原因是这两个收集的依赖的触发时机是不同的
          //   第一个触发时机是当属性值被修改时触发
          //   第二个触发时机是在使用$set或Vue.set给数据对象添加新属性的操作
          // 由于Js语言的限制，在没有Proxy之前Vue没有办法拦截到给对象添加属性的操作
          // 因此只能手动触发依赖事件
          // 假设Vue.set函数代码为
          // Vue.set = function(obj, key, val) {
          //   defineReactive(obj, key, val);
          //   obj.__ob__.dep.notify();
          // }
          // 用上面的代码给data.a对象添加新的属性
          // Vue.set(data.a, 'c', 1);
          // 实际上触发了data.a.__ob__.dep.notify()
          // 所以__ob__属性及__ob__.dep的主要作用是为了添加、删除属性时有能力触发依赖，而这就是Vue.set或Vue.delete的原理
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    // set函数主要完成两件事，第一正确地为属性设置新值，第二触发相应的依赖
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 判断值是否有变化，没有变则不需要做额外的处理
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
