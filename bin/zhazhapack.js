#!/usr/bin/env node   // 定义node环境下执行
// 执行webpack命令时, 会首先触发这个文件
// 获取webpack.config.js配置
const path = require('path')
const config = require(path.resolve('webpack.config.js'))
// 解析文件
const Compiler = require('../lib/compiler')
new Compiler(config).start()