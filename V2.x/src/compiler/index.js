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
  // 举例
  // <ul :class="bindCls" class="list" v-if="isShow">
  //   <li v-for="(item,index) in data" @click="clickItem(index)">{{item}}:{{index}}</li>
  // </ul>
  // 转换后生成的AST应该为
  // ast = {
  //   'type': 1,
  //   'tag': 'ul',
  //   'attrsList': [],
  //   'attrsMap': {
  //     ':class': 'bindCls',
  //     'class': 'list',
  //     'v-if': 'isShow'
  //   },
  //   'if': 'isShow',
  //   'ifConditions': [{
  //     'exp': 'isShow',
  //     'block': // ul ast element
  //   }],
  //   'parent': undefined,
  //   'plain': false,
  //   'staticClass': 'list',
  //   'classBinding': 'bindCls',
  //   'children': [{
  //     'type': 1,
  //     'tag': 'li',
  //     'attrsList': [{
  //       'name': '@click',
  //       'value': 'clickItem(index)'
  //     }],
  //     'attrsMap': {
  //       '@click': 'clickItem(index)',
  //       'v-for': '(item,index) in data'
  //      },
  //     'parent': // ul ast element
  //     'plain': false,
  //     'events': {
  //       'click': {
  //         'value': 'clickItem(index)'
  //       }
  //     },
  //     'hasBindings': true,
  //     'for': 'data',
  //     'alias': 'item',
  //     'iterator1': 'index',
  //     'children': [
  //       'type': 2,
  //       'expression': '_s(item)+":"+_s(index)'
  //       'text': '{{item}}:{{index}}',
  //       'tokens': [
  //         {'@binding':'item'},
  //         ':',
  //         {'@binding':'index'}
  //       ]
  //     ]
  //   }]
  // }
  const ast = parse(template.trim(), options)
  if (options.optimize !== false) {
    // 调用optimize函数优化ast
    // 优化的原因是Vue是数据驱动，是响应式的，模板并不是所有数据都是响应式的，有很多数据是首次渲染后就
    // 就永远不会变化的，那么这部分数据生成的DOM也不会变化，可以在patch的过程跳过对它们的对比
    optimize(ast, options)
    // 经过优化后
    // ast = {
    //   'type': 1,
    //   'tag': 'ul',
    //   'attrsList': [],
    //   'attrsMap': {
    //     ':class': 'bindCls',
    //     'class': 'list',
    //     'v-if': 'isShow'
    //   },
    //   'if': 'isShow',
    //   'ifConditions': [{
    //     'exp': 'isShow',
    //     'block': // ul ast element
    //   }],
    //   'parent': undefined,
    //   'plain': false,
    //   'staticClass': 'list',
    //   'classBinding': 'bindCls',
    //   'static': false,
    //   'staticRoot': false,
    //   'children': [{
    //     'type': 1,
    //     'tag': 'li',
    //     'attrsList': [{
    //       'name': '@click',
    //       'value': 'clickItem(index)'
    //     }],
    //     'attrsMap': {
    //       '@click': 'clickItem(index)',
    //       'v-for': '(item,index) in data'
    //      },
    //     'parent': // ul ast element
    //     'plain': false,
    //     'events': {
    //       'click': {
    //         'value': 'clickItem(index)'
    //       }
    //     },
    //     'hasBindings': true,
    //     'for': 'data',
    //     'alias': 'item',
    //     'iterator1': 'index',
    //     'static': false,
    //     'staticRoot': false,
    //     'children': [
    //       'type': 2,
    //       'expression': '_s(item)+":"+_s(index)'
    //       'text': '{{item}}:{{index}}',
    //       'tokens': [
    //         {'@binding':'item'},
    //         ':',
    //         {'@binding':'index'}
    //       ],
    //       'static': false
    //     ]
    //   }]
    // }
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
