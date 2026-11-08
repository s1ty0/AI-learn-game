# 中文档案深度与缺口报告

内容版本：0.2.1。由当前内容索引生成。

八项检查面已写入8份深入草稿，但章节存在不证明内容已充分、正确或教学有效。所有实体仍待独立审校，研究层不视为完成。

| 目标 | 当前深入内容 | 明确未完成项 |
| --- | --- | --- |
| 损失函数：让训练有明确的比较标准 | [分层草稿](../knowledge/zh-CN/deep/01-loss-function.md) | 概率建模推导；Huber/对比/排序损失独立档案 |
| 梯度：描述目标怎样随参数变化 | [分层草稿](../knowledge/zh-CN/deep/02-gradient.md) | 自动微分与反向传播完整实现；多变量形状规范 |
| 梯度下降：用局部信息逐步更新参数 | [分层草稿](../knowledge/zh-CN/deep/03-gradient-descent.md) | 强凸收敛率证明；随机梯度方差分析；完整优化器比较 |
| L2 正则化：把参数惩罚加入目标 | [分层草稿](../knowledge/zh-CN/deep/04-l2-regularization.md) | 岭回归矩阵解；高斯先验推导；完整Adam/AdamW对照 |
| Transformer：让不同位置的信息相互联系 | [分层草稿](../knowledge/zh-CN/deep/05-transformer.md) | 原始完整编码器—解码器复现；现代变体深入档案；真实文本与独立评价 |
| token：文本怎样变成模型的输入单位 | [分层草稿](../knowledge/zh-CN/deep/06-token.md) | 完整词表训练；真实tokenizer回归样本 |
| 缩放点积注意力：算权重，再汇聚信息 | [分层草稿](../knowledge/zh-CN/deep/07-scaled-dot-product-attention.md) | 手工反向推导；融合内核与缓存实验；现代注意力变体 |
| 交叉熵损失：检查给目标类别分配了多少概率 | [分层草稿](../knowledge/zh-CN/deep/08-cross-entropy.md) | 多标签与二元损失独立档案；语言模型完整目标错位实验 |

跨领域覆盖仍看 catalog-coverage.md。单个代表样本的深度不能替代其他算法、来源和关系建设。

数值实验覆盖：二次目标学习率边界、有限差分检查、L2解析最优值、固定对角缩放反例、稳定分类损失、注意力与掩码、玩具合并规则。

已有[一层因果教学模型与训练/生成流程](../knowledge/zh-CN/transformer/README.md)，不再仅限单头内核。其样本为合成编号；尚无真实词表、原始完整编码器—解码器复现、独立测试质量结论、GPU内核比较或学习者试学。
