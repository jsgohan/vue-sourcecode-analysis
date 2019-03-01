/* @flow */

import {
  isPreTag,
  mustUseProp,
  isReservedTag,
  getTagNamespace
} from '../util/index'

import modules from './modules/index'
import directives from './directives/index'
import { genStaticKeys } from 'shared/util'
import { isUnaryTag, canBeLeftOpenTag } from './util'

export const baseOptions: CompilerOptions = {
  expectHTML: true,
  // modules实际输出是
  // [{ // ./modules/class.js
  //   staticKeys: ['staticClass'],
  //   transformNode,
  //   genData
  // }, { // ./modules/style.js
  //   staticKeys: ['staticStyle'],
  //   transformNode,
  //   genData
  // }, { // ./modules/model.js
  //   preTransformNode
  // }]
  modules,
  // directives实际输出是
  // {
  //   // ./directives/model.js
  //   model: function() {},
  //   // ./directives/html.js
  //   html: function() {},
  //   // ./directives/text.js
  //   text: function() {}
  // }
  directives,
  // 函数，作用是通过给定的标签名字检查标签是否是'pre'标签
  isPreTag,
  // 通过makeMap生成的函数，作用是检测给定的标签是否是一元标签
  // 一元标签包括 area,base,br,col,embed,frame,hr,img,input,isindex,keygen,link,meta,param,source,track,wbr
  isUnaryTag,
  // 函数，作用是用来监测一个属性在标签中是否使用props进行绑定
  mustUseProp,
  // 通过makeMap生成的函数，作用是检测一个标签是否是那些虽然不是一元标签，但却可以自己补全并闭合标签
  // 这类标签包括: colgroup,dd,dt,li,options,p,td,tfoot,th,thead,tr,source
  // 理解，如<p>Some content</p> 其实也可以省略闭合标签，直接写<p>Some content，浏览器会自动补全
  canBeLeftOpenTag,
  // 函数，作用是检查给定的标签是否是保留的标签
  isReservedTag,
  // 函数，作用是获取元素(标签)的命名空间
  getTagNamespace,
  // 作用是根据编译器选项的modules选项生成一个静态键字符串
  staticKeys: genStaticKeys(modules)
}
