/* @flow */

import { noop, extend } from 'shared/util'
import { warn as baseWarn, tip } from 'core/util/debug'

type CompiledFunctionResult = {
  render: Function;
  staticRenderFns: Array<Function>;
};

/**
 * 接收两个参数
 * @param code 函数体字符串，该字符串将通过new Function(code)的方式创建为函数
 * @param errors 数组，作用是当采用new Function(code)创建函数发生错误时用来收集错误
 */
function createFunction (code, errors) {
  try {
    return new Function(code)
  } catch (err) {
    errors.push({ err, code })
    return noop
  }
}

export function createCompileToFunctionFn (compile: Function): Function {
  const cache = Object.create(null)

  return function compileToFunctions (
    template: string,
    options?: CompilerOptions,
    vm?: Component
  ): CompiledFunctionResult {
    options = extend({}, options)
    const warn = options.warn || baseWarn
    delete options.warn

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production') {
      // detect possible CSP restriction
      // 用在非生产环境下执行，使用try catch语句块对new Function('return 1')进行捕获
      // 如果有错误发生且错误的内容中包含诸如'unsafe-eval'或者'CSP'时就给出警告
      // 将模板字符串编译成渲染函数又依赖new Function()，解决方案有两个：
      // 1. 放宽CSP策略
      // 2. 预编译
      try {
        new Function('return 1')
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          warn(
            'It seems you are using the standalone build of Vue.js in an ' +
            'environment with Content Security Policy that prohibits unsafe-eval. ' +
            'The template compiler cannot work in this environment. Consider ' +
            'relaxing the policy to allow unsafe-eval or pre-compiling your ' +
            'templates into render functions.'
          )
        }
      }
    }

    // check cache
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template
    // 缓存字符串模板的编译结果，防止重复编译，提升性能
    if (cache[key]) {
      return cache[key]
    }

    // compile
    // 核心代码
    // 来自./create-compiler.js
    // compiled是一个对象且对象可能包含两个属性errors和tips，这两个属性分别包含了编译过程中的错误和提示信息
    const compiled = compile(template, options)

    // check compilation errors/tips
    // 用来检查使用功能compile对模板进行编译的过程中是否存在错误和提示，如果存在那么需要将其打印
    if (process.env.NODE_ENV !== 'production') {
      if (compiled.errors && compiled.errors.length) {
        warn(
          `Error compiling template:\n\n${template}\n\n` +
          compiled.errors.map(e => `- ${e}`).join('\n') + '\n',
          vm
        )
      }
      if (compiled.tips && compiled.tips.length) {
        compiled.tips.forEach(msg => tip(msg, vm))
      }
    }

    // turn code into functions
    // res是一个空对象且就是最终的返回值
    const res = {}
    // fnGenErrors
    const fnGenErrors = []
    // render属性实际上就是最终生成的渲染函数
    // 值是通过createFunction创建出来的，createFunction函数定义在to-function.js文件开头
    // 可以得知，经过compile函数编译模板字符串后所得到的是字符串形式的函数体
    res.render = createFunction(compiled.render, fnGenErrors)
    // staticRenderFns主要作用是渲染优化
    res.staticRenderFns = compiled.staticRenderFns.map(code => {
      return createFunction(code, fnGenErrors)
    })

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production') {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        warn(
          `Failed to generate render function:\n\n` +
          fnGenErrors.map(({ err, code }) => `${err.toString()} in\n\n${code}\n`).join('\n'),
          vm
        )
      }
    }

    // 缓存结果
    return (cache[key] = res)
  }
}
// toString.js主要作用有
// 1. 缓存编译结果，通过createCompileToFunctionFn函数内声明的cache常量实现
// 2. 调用compile函数将模板字符串转换成渲染函数字符串
// 3. 调用createFunction函数将模板函数字符串转换成真正的渲染函数
// 4. 打印编译错误，包括：模板字符串 -> 渲染函数字符串 以及 渲染函数字符串 -> 渲染函数 这两个阶段的错误
