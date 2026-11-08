# 教学实验

## 标准库数值实验

```powershell
python examples/learning_lab.py
```

只需Python标准库。展示损失、有限差分、梯度下降、L2、注意力、交叉熵与玩具合并；不是完整神经网络。

## 完整教学小模型

```powershell
python examples/tiny_transformer.py
```

需要PyTorch。本轮使用现有的Python 3.13.14与PyTorch 2.14.0+cpu，未安装依赖、下载权重或使用GPU。教学模型是一层因果Decoder（用于逐步生成的解码结构），具体配置与局限见[专题入口](../knowledge/zh-CN/transformer/README.md)。

模型实验会训练并输出形状、损失和生成编号，不持久化权重，不代表真实文本模型质量。完整检查命令为：

```powershell
python -m unittest discover -s tests
```

包含模型的检查需要PyTorch；测试总量不作为教学效果指标。

## 图解重建

```powershell
python scripts/draw_transformer_flow.py
```

需要Pillow及脚本指定的Windows中文字体；两者用于图解生成，不是模型运行依赖。源脚本同时生成SVG与PNG，修改图后需要重新查看成图。
