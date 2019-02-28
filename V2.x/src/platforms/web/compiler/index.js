/* @flow */

import { baseOptions } from './options'
// 引自src/compiler/index.js
import { createCompiler } from 'compiler/index'

const { compile, compileToFunctions } = createCompiler(baseOptions)

export { compile, compileToFunctions }
