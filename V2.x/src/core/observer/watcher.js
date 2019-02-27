/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  computed: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  dep: Dep;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  /**
   * vm: 组件实例对象vm
   * expOrFn: 要观察的表达式
   * cb: 当被观察的表达式的值变化时的回调函数
   * options: 一些传递给当前观察者对象的选项
   * isRenderWatcher: 用来标识该观察者实例是否是渲染函数的观察者
   */
  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.computed = !!options.computed
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.computed = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.computed // for computed watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = function () {}
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 计算属性的观察者和其他观察者实例对象的处理方式是不同的
    if (this.computed) {
      this.value = undefined
      this.dep = new Dep()
    } else {
      this.value = this.get()
    }
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   * 求值，目的是第一能够触发访问器属性的get拦截器函数，第二个是能够获得被观察目标的值
   */
  get () {
    // pushTarget函数的作用就是用来为Dep.target属性赋值的，pushTarget函数会将接收到的参数赋值给Dep.target属性
    // 所以Dep.target保存着一个观察者对象，其实这个观察对象就是即将要收集的目标
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        // traverse函数的作用是递归地读取被观察属性的所有子属性的值，这样被观察属性的所有子属性都将会收集到观察者，从而达到深度观测的目的
        traverse(value)
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    // 避免收集重复依赖
    if (!this.newDepIds.has(id)) {
      // newDepIds和newDeps两个属性的值所存储的总是当次求值所收集到的Dep实例对象
      // depIds和deps两个属性的值所存储的总是上一次求值过程中所收集的Dep实例对象
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      // 在多次求值中避免收集重复依赖
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.computed) {
      // A computed property watcher has two modes: lazy and activated.
      // It initializes as lazy by default, and only becomes activated when
      // it is depended on by at least one subscriber, which is typically
      // another computed property or a component's render function.
      if (this.dep.subs.length === 0) {
        // In lazy mode, we don't want to perform computations until necessary,
        // so we simply mark the watcher as dirty. The actual computation is
        // performed just-in-time in this.evaluate() when the computed property
        // is accessed.
        this.dirty = true
      } else {
        // In activated mode, we want to proactively perform the computation
        // but only notify our subscribers when the value has indeed changed.
        // 调用getAndInvoke方法会重新求值并对比新旧值是否相同，如果满足相同的条件则不会触发响应，只有当值确实变化时才会触发响应
        this.getAndInvoke(() => {
          // this.dep 中将收集渲染函数作为依赖，执行后就会导致重新渲染，最终完成视图的更新
          this.dep.notify()
        })
      }
    } else if (this.sync) {
      // 在没有指定观察者是同步更新，那么观察者的更新机制就是异步的
      // 例如：
      // watch: {
      //   someWatch: {
      //     handler() {},
      //     sync: true
      //   }
      // }
      // Vue提供了Vue.config.async全局配置，它默认值为true，默认配置在src/core/config.js中
      // 可以全局修改Vue.config.async = false 此时所有观察者都将会同步执行
      this.run()
    } else {
      // 异步更新：每次修改属性的值之后并没有立即重新求值，而是将需要执行更新操作的观察者放入一个队列中
      // 当修改name属性值时，由于name属性收集了渲染函数的观察者(后面称为renderWatcher)作为依赖
      // 所以此时renderWatcher会被添加到队列中，接着修改age属性的值，由于age属性也收集了renderWatcher作为依赖，
      // 所以此时也尝试将renderWatcher添加到队列中，但由于renderWatcher已经存在于队列中了，所以并不会重复添加
      // 这样队列中就只会存在一个renderWatcher。当所有的突变完成之后，再一次性的执行队列中所有观察者的更新方法
      // 同事清空队列，就达到了优化的目的
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    // active属性用来标识观察者是否处于激活状态，或者可用状态
    if (this.active) {
      this.getAndInvoke(this.cb)
    }
  }

  getAndInvoke (cb: Function) {
    const value = this.get()
    // 下面的判断是给非渲染函数类型的观察者准备的
    // 因为如果是渲染函数的观察者，this.get方法的返回值其实就等价于updateComponent函数的返回值，这个值将永远都是undefined
    // 如果是非渲染函数，它将用来对比新旧两次求值的结果，当值不相等的时候回调用通过参数传递进来的回调
    if (
      value !== this.value ||
      // Deep watchers and watchers on Object/Arrays should fire even
      // when the value is the same, because the value may
      // have mutated.
      // 之所以要判断类型是否是对象，因为对象是引用的，内部的属性发生变化，但判断总是相等，这样就会产生问题
      isObject(value) ||
      this.deep
    ) {
      // set new value
      const oldValue = this.value
      this.value = value
      // this.dirty属性是为计算属性准备的
      this.dirty = false
      // this.user代表开发者定义，指那些通过watch选项或$watch函数定义的观察者，这些观察者的特点是回调函数是由开发者编写的
      // 所以这些回调函数在执行的过程中行为是不可预知的，很可能会出现错误，这时候将放在try...catch语句块中，这样当错误发生时就能够给开发者一个友好的提示
      if (this.user) {
        try {
          cb.call(this.vm, value, oldValue)
        } catch (e) {
          handleError(e, this.vm, `callback for watcher "${this.expression}"`)
        }
      } else {
        cb.call(this.vm, value, oldValue)
      }
    }
  }

  /**
   * Evaluate and return the value of the watcher.
   * This only gets called for computed property watchers.
   * 用于手动求值
   */
  evaluate () {
    if (this.dirty) {
      // 创建计算属性观察者对象时传递给Watcher类的第二个参数为getter常量，他就是开发者在定义计算属性时的函数
      this.value = this.get()
      this.dirty = false
    }
    return this.value
  }

  /**
   * Depend on this watcher. Only for computed property watchers.
   */
  depend () {
    // 在渲染函数执行之前，Dep.target的值必然是渲染函数的观察者对象
    // 所以计算属性观察者对象的this.dep属性中所收集的就是渲染函数的观察者对象
    if (this.dep && Dep.target) {
      this.dep.depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      // _isBeingDestroyed为真表示组件已经被销毁
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
