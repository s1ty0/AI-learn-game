# 交叉熵损失：检查给目标类别分配了多少概率

状态：中文知识卡草稿。尚未完成独立审校或试玩。

**核心：在本卡的单标签分类情境中，目标类别分到的概率越小，受到的惩罚越大。**

## 先看一个样本

真实类别为 A。预测一给 A 的概率是 0.8，预测二给 A 的概率是 0.2。采用自然对数，损失分别约为 0.223 和 1.609。

## 本卡采用的定义

单个样本、正确类别为 y、未使用类别加权或标签平滑时：

\[
\ell=-\log p_y
\]

\(p_y\) 是预测给正确类别的概率，\(\ell\) 是该样本损失，log 采用自然对数。更一般的目标分布需要不同展开，不能只记这一个特例。

## 公式和接口别混淆

logits（尚未转换为类别概率的模型输出分数）不是概率。PyTorch（深度学习计算框架）的 `CrossEntropyLoss` 接收 logits，并在内部处理对应的归一化与对数运算。不能因为公式写着概率，就先额外归一化后当作 logits 传入。

## 游戏与检查候选

让玩家分配一组和为1的概率，再显示对真实类别的损失。换一个真实类别后重新比较；进阶任务辨认概率与 logits 的输入差异。练习不替代完整概率理论教学。

## 资料

[PyTorch CrossEntropyLoss 官方说明](https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html)；[D2L 中文 softmax 回归](https://zh.d2l.ai/chapter_linear-networks/softmax-regression.html)。

相关卡：[损失函数](./01-loss-function.md)。

继续深入：[完整分层档案](./deep/08-cross-entropy.md)，包含软目标、logits梯度、稳定计算、KL联系、聚合与目标错位。
