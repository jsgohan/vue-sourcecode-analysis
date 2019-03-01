/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

// '编译器的创建者'的创建者
export function createCompilerCreator (baseCompile: Function): Function {
  return function createCompiler (baseOptions: CompilerOptions) {
    // compile函数的作用是
    // 1. 生成最终编译器选项finalOptions
    // 2. 对错误的收集
    // 3. 调用baseCompile编译模板
    function compile (
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      // finalOptions常量才是最终的编译选项参数
      // 其中baseOptions对象为
      // {
      //   expectHTML: true,
      //   modules,
      //   isPreTag,
      //   isUnaryTag,
      //   mustUseProp,
      //   canBeleftOpenTag,
      //   isReservedTag,
      //   getTagNamespace,
      //   staticKeys: genStaticKeys(modules)
      // }
      const finalOptions = Object.create(baseOptions)
      const errors = []
      const tips = []
      finalOptions.warn = (msg, tip) => {
        (tip ? tips : errors).push(msg)
      }

      // options是用来提供定制能力的扩展选项，因此，实际以下代码的作用就是将options对象混合到finalOptions中
      if (options) {
        // merge custom modules
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }

      // compile函数对模板的编译时委托baseCompile完成的
      // compiled是baseCompile对模板的编译结果，该结果中包含了模板编译后的抽象语法树(AST)，可以通过compiled.ast访问该语法树
      const compiled = baseCompile(template, finalOptions)
      // 作用是用来通过抽象语法树来检查模板中是否存在错误表达式，通过detectErrors函数实现
      if (process.env.NODE_ENV !== 'production') {
        errors.push.apply(errors, detectErrors(compiled.ast))
      }
      // 将收集到的错误(errors)和提示(tips)添加到compiled上并返回
      compiled.errors = errors
      compiled.tips = tips
      return compiled
    }

    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
