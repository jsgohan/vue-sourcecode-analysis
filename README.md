# Vue源码分析注释
> 该文档将会对Vue的源码分析，并做中文注释

强烈推荐阅读[Vue技术内幕](http://hcysun.me/vue-design/)，对理解非常有帮助。但由于作者不再对编译器之代码的生成、虚拟DOM解析和虚拟DOM补丁算法详解更新，本人希望可以通过阅读Vue源码对这三部分进行注释。

阅读源码是提升自身水平的很好的方式，尤其是优秀的源码库。

注释期间，使用的是2.5.17-beta.0版本的源码解析的

今年预计年中会出Vue3.0，届时如果有时间，也会对这个版本进行注释