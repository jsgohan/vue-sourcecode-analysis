/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
// 编译器的创建者
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 编译器函数调用
  // 调用parse函数将字符串模板解析成抽象语法树(AST)
  const ast = parse(template.trim(), options)
  if (options.optimize !== false) {
    // 调用optimize函数优化ast
    optimize(ast, options)
  }
  // generate就是生成指定平台的代码，如果想生成别的平台代码，可以在ast不变的基础上，重写generate函数即可
  // 调用generate函数将ast编译成渲染函数
  const code = generate(ast, options)
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})
