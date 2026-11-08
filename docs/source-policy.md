# 来源登记与内容核查规则

版本：0.1.0。日期：2026-11-07。

## 1. 来源各负其责

- 原始论文：核对方法、假设、实验主张和版本；摘要不能代替正文公式与实验核查。
- 官方文档：核对接口、输入、数值与实现约定；实现细节不自动推广为普遍理论。
- 作者教材与课程：组织知识和教学表达；按具体章节审阅，不因首页可信就审核通过全书。
- 题库与通俗文章：发现常见问题、误解和易懂表达；关键结论再关联可靠依据。

优先记录作者原站、官方文档、原始论文和可定位的章节。转载和聚合页面作为发现线索，能找到原出处时关联原出处。

## 2. 访问与审核分开

`index_checked` 表示看过目录，`page_checked` 表示看过该页面，`abstract_checked` 表示看过论文摘要，`section_checked` 表示看过记录注明的章节。它们均不表示关联实体已通过完整教学审校。

记录来源 URL、作者或维护方、版本、核查日期与实际查看范围。论文链接尽量固定版本；动态文档保存实际看到的版本入口，后续更新重新登记影响。

当前已登记的入口示例：

- [PyTorch 神经网络文档](https://docs.pytorch.org/docs/2.15/nn.html)、[优化器文档](https://docs.pytorch.org/docs/2.15/optim.html)：用于实现参考，已查看部分索引与条目。
- [D2L 权重衰减章节](https://d2l.ai/chapter_linear-regression/weight-decay.html)、[线性回归章节](https://d2l.ai/chapter_linear-regression/linear-regression.html)：用于核对部分正则与更新表述，尚未审校整章。
- [Transformer 原始论文](https://arxiv.org/html/1706.03762v7)、[AdamW 原始论文](https://arxiv.org/html/1711.05101v3)：从摘要登记推进到部分正文查看；分别定位架构与注意力部分、L2 与优化器区别的介绍。尚未完整审校、复现实验或核查全部变体。
- [Hugging Face 课程介绍](https://huggingface.co/learn/llm-course/chapter1/1)、[CodeFun2000](https://codefun2000.com/)：登记课程与题库入口，尚未逐课逐题审阅。

完整范围以 `data/catalog/sources.json` 中的 `checked_scope` 为准。

中文版已补[梯度下降](https://zh.d2l.ai/chapter_optimization/gd.html)、[权重衰减](https://zh.d2l.ai/chapter_multilayer-perceptrons/weight-decay.html)、[Transformer](https://zh.d2l.ai/chapter_attention-mechanisms/transformer.html)等作者教材章节及[Hugging Face 中文 tokenizer 讲解](https://huggingface.co/learn/llm-course/zh-CN/chapter2/4)。本项目中文知识卡为原创组织的教学草稿，末尾保留来源，不复制整章。

## 3. 内容进入审核的条件

1. 明确实体、解释深度、适用条件与待核查命题。
2. 定位到具体依据；正文、公式、实现和经验性结果分别核查。
3. 记录重要例外，避免把特定优化器、架构或任务中的结论写成无条件规则。
4. 处理来源分歧，检查例子、反例与代码能否支持讲解。
5. 记录审校角色、日期、结论及剩余问题，随后才改变审核状态。

AI 草稿允许用于提案；浏览网页或通过结构校验不能直接将内容标成已审核。

## 4. 保存与维护

当前只保存来源元数据、链接和原创登记说明，未导入全文、付费题目或图片。复用范围尚未核查，不能从可访问推断可以再分发。

来源变化、失效、纠错和新方法进入维护队列。每次内容发布检查关联实体、关系、教学与评价；旧成果保留原版本。尚无自动巡检或定时收集程序。
