/* @flow */

/**
 * Expand input[v-model] with dyanmic type bindings into v-if-else chains
 * Turn this:
 *   <input v-model="data[type]" :type="type">
 * into this:
 *   <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
 *   <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
 *   <input v-else :type="type" v-model="data[type]">
 * 为什么要将一个input标签扩展为三个呢？针对的是checkbox、radio和其他input标签
 * 由于使用了绑定的type属性，所以该input标签的类型时不确定的，input标签类型为checkbox、radio，对应的行为是不一样的
 * 这里不做区分也行，但是就不能知道目标input元素的类型时什么的，为了保证实现所有类型input标签的功能可用，所以必须保证生成的代码能完成所有类型标签的额工作
 * 也就是，要么选择在便一阶段区分类型，要么就在运行时阶段区分类型，Vue选择的是在编译阶段就将类型区分开来
 */

import {
  addRawAttr,
  getBindingAttr,
  getAndRemoveAttr
} from 'compiler/helpers'

import {
  processFor,
  processElement,
  addIfCondition,
  createASTElement
} from 'compiler/parser/index'

// 该函数只用来处理input标签
function preTransformNode (el: ASTElement, options: CompilerOptions) {
  // 只有input标签才会执行预处理工作
  if (el.tag === 'input') {
    const map = el.attrsMap
    // 检查是否使用了v-model属性
    if (!map['v-model']) {
      return
    }

    // typeBinding变量保存的是该input标签上绑定的type属性的值
    // 举例 <input v-model="val" :type="inputType" /> 所以typeBinding变量的值为字符串'inputType'
    let typeBinding
    if (map[':type'] || map['v-bind:type']) {
      typeBinding = getBindingAttr(el, 'type')
    }
    // 不使用v-bind或:绑定type属性，仍然可以通过如下方式绑定属性
    // <input v-model="val" v-bind="{type: inputType}" />
    if (!map.type && !typeBinding && map['v-bind']) {
      typeBinding = `(${map['v-bind']}).type`
    }

    if (typeBinding) {
      // 举例<input v-model="val" :type="inputType" v-if="display" />
      // ifCondition值为字符串'display'
      const ifCondition = getAndRemoveAttr(el, 'v-if', true)
      // ifConditionExtra常量值为&&(display)
      const ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``
      const hasElse = getAndRemoveAttr(el, 'v-else', true) != null
      const elseIfCondition = getAndRemoveAttr(el, 'v-else-if', true)
      // 1. checkbox
      // 克隆一个与原始标签的元素描述对象一模一样的元素描述对象
      const branch0 = cloneASTElement(el)
      // process for on the main node
      // 接下来需要处理v-for、和processElement函数中的别的
      processFor(branch0)
      // 将type="checkbox"添加到元素描述对象的el.attrsMap和el.attrsList数组中
      addRawAttr(branch0, 'type', 'checkbox')
      processElement(branch0, options)
      // 避免在后面继续解析时重复的解析
      branch0.processed = true // prevent it from double-processed
      // 举例 <input v-model="val" :type="inputType" v-if="display" />
      // branch0.if='(${inputType})==='checkbox'&&display
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra
      // 还要将该标签的元素描述对象添加到其自身的el.ifConditions数组中
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0
      })
      // 2. add radio else-if condition
      const branch1 = cloneASTElement(el)
      getAndRemoveAttr(branch1, 'v-for', true)
      addRawAttr(branch1, 'type', 'radio')
      processElement(branch1, options)
      addIfCondition(branch0, {
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1
      })
      // 3. other
      const branch2 = cloneASTElement(el)
      getAndRemoveAttr(branch2, 'v-for', true)
      addRawAttr(branch2, ':type', typeBinding)
      processElement(branch2, options)
      addIfCondition(branch0, {
        exp: ifCondition,
        block: branch2
      })

      if (hasElse) {
        branch0.else = true
      } else if (elseIfCondition) {
        branch0.elseif = elseIfCondition
      }

      return branch0
    }
  }
}

function cloneASTElement (el) {
  // 这里使用数组的slice()方法复刻一个新的el.attrsList数组，避免和原始描述对象互相干扰
  return createASTElement(el.tag, el.attrsList.slice(), el.parent)
}

export default {
  preTransformNode
}
