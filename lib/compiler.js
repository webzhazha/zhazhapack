// 将编译为打包文件的操作存放到这里
const path = require('path')
const fs = require('fs')
// 生成ast树
const parser = require('@babel/parser')
// 解析ast树, 并针对性替换
const traverse = require('@babel/traverse').default
const generate = require("@babel/generator").default
const ejs = require('ejs')
const { SyncHook } = require('tapable')
class Compiler {
  constructor(config){
    this.config = config
    this.entry = config.entry
    this.output = config.output
    // node执行的文件路径
    this.root = process.cwd()
    // 存放总的结构  文件名: 文件解析之后的内容
    this.modules = {}
    // loader配置
    this.rules = config.module.rules
    // 先定义钩子, 
    this.hooks = {
      compile: new SyncHook(),
      afterCompiler: new SyncHook(),
      emit: new SyncHook(),
      afterEmit: new SyncHook(),
      done: new SyncHook()
    }
    // 初始化时, 调用所有的plugins
    if(Array.isArray(this.config.plugins)){
      this.config.plugins.forEach(plugin=>{
        plugin.apply(this)
      })
    }
  }
  // 异步获取文件内容
  getSource(modulePath){
    return fs.readFileSync(modulePath, 'utf-8')
  }
  // 开始分析入口文件
  devAnalysis(modulePath){
    // 开始分析, 使用ast替换
    // 获取文件内容
    let source = this.getSource(modulePath)
    // 获取源码, 如果path能够匹配loader  则开始编译
    // 提取编译loader的公共代码
    let handleLoader = (usepath, options)=>{
      // 获取loader文件
      let loaderPath = path.join(this.root, usepath)
      // 导出loader内部的方法
      let loaderSorce = require(loaderPath)
      source = loaderSorce.call(options,source)
    }
    // 倒叙循环
    for(let i = this.rules.length-1; i>=0; i--){
      let { test, use } = this.rules[i]
      // 判断是否匹配
      if(test.test(modulePath)){
        // 说明这个源文件需要对应loader来去解析  每个js文件只要匹配, 需要将所有loader执行
        // 判断use是什么  数组  字符串  对象
        if(Array.isArray(use)){
          for(let j = use.length-1; j>=0; j--){
            // // 获取loader文件
            // let loaderPath = path.join(this.root, use[j])
            // // 导出loader内部的方法
            // let loaderSorce = require(loaderPath)
            // source = loaderSorce(source)
            handleLoader(use[j])
          }
        }else if(typeof use === 'string'){
            // 获取loader文件
            // let loaderPath = path.join(this.root, use)
            // // 导出loader内部的方法
            // let loaderSorce = require(loaderPath)
            // source = loaderSorce(source)
            handleLoader(use)
        }else if(use instanceof Object){
            // 获取loader文件
            // let loaderPath = path.join(this.root, use.loader)
            // // 导出loader内部的方法
            // let loaderSorce = require(loaderPath)
            // source = loaderSorce(source)
            handleLoader(use.loader, {query: use.options})
        }
      }
    }

    // 存放所有的依赖
    let dependencies = []

    // 解析成ast树
    let ast = parser.parse(source)
    // 修改ast树上的部分值
    traverse(ast, {
      CallExpression(p){
        // 知道require替换为__webpack_require__
        if(p.node.callee.name==='require'){
          p.node.callee.name = '__webpack_require__'
          // 替换路径
          let paths = p.node.arguments[0].value
          // 替换/   unix是/  window是\
          let newpaths = ('./'+ path.join('src',paths)).replace(/\\+/g,'/')
          p.node.arguments[0].value = newpaths
          // 在单个模块中, 没解析到一个引入模块, 就存放
          dependencies.push(p.node.arguments[0].value)
        }
      }
    })
    let sourceCode = generate(ast).code
    // 解析之后的内容进行存放
    let filepath = './'+ path.relative(this.root, modulePath).replace(/\\+/g, '/')
    this.modules[filepath] = sourceCode
    // 每个引入依赖都循环分析  递归调用
    dependencies.forEach(dep=>{
      this.devAnalysis(path.join(this.root, dep))
    })
  }
  // 初始化开始执行
  start(){
    // 
    this.hooks.compile.call()
    // 解析
    this.devAnalysis(path.join(this.root, this.entry))
    // 使用模板渲染
    let template = this.getSource(path.join(__dirname,'../template/tem.ejs'))
    let result = ejs.render(template,{
      entry: this.entry,
      modules: this.modules
    })
    // console.log(result);
    // 制作好打包模板之后, 将文件输出到指定的打包文件中
    let outputPath = path.join(this.output.path, this.output.filename)
    fs.writeFileSync(outputPath, result)
    // 触发webpack全局钩子, 然后每个plugin中的对应钩子会执行
    // plugin在具体每个钩子中执行具体的操作
    this.hooks.afterCompiler.call()
    this.hooks.emit.call()
    this.hooks.afterEmit.call()
    this.hooks.done.call()
  }
}

module.exports = Compiler