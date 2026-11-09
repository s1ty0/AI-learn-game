"""Original transfer tasks. Rubrics stay server-side until the attempt is submitted."""
TASKS = {
 "mask": {"title":"读取边界的新情境", "family":"causal-transfer", "node":"mask",
  "prompt":"四个位置编号0至3。位置2只读取位置0、1、2，其组合方式保持固定。现在只把位置3的数值从5改成50。位置2的输出会怎样？解释信息怎样传递，并说明结论依赖什么条件；举出一个结论可能不成立的改动。",
  "options":["保持不变","一定增大10倍","信息不足，任何变化都可能"], "correct":0,
  "rationale":"按题设，位置3不在位置2的读取范围内；只改这个被排除的值不会经该固定组合改变位置2。若读取范围或其他输入也改了，结论需重新检查。",
  "criteria":[
   {"id":"path","title":"说明影响路径", "requirement":"明确位置3被排除，不只说‘因为有掩码’。"},
   {"id":"conditions","title":"说清成立条件", "requirement":"说明其他可读输入、读取规则和组合方式固定；不推广为模型全部输出都不变。"},
   {"id":"boundary","title":"给出有效边界", "requirement":"例如允许读取位置3，或同时改变可读输入；能解释为何需要重新判断。"}]},
 "weights": {"title":"汇聚比例的新情境", "family":"weighted-transfer", "node":"prism",
  "prompt":"两个信息值为−4和8，参与比例分别为0.75和0.25，汇聚按‘各自相乘再相加’计算。汇聚结果是多少？解释为什么；如果比例随输入重新变化，能否仍直接使用这组比例得出新结果？给出成立条件。",
  "options":["2","−1","4"], "correct":1,
  "rationale":"0.75×(−4)+0.25×8=−3+2=−1。此计算使用给定比例；比例重新计算时需用新比例，不能固定套用旧结果。",
  "criteria":[
   {"id":"path","title":"写出计算关系", "requirement":"逐项加权再相加，保留负值的符号，不混同等权平均。"},
   {"id":"conditions","title":"说清固定量", "requirement":"区分给定的值/比例与随输入重新计算的比例。"},
   {"id":"boundary","title":"指出适用边界", "requirement":"比例变化后重新计算；不能仅由某个值增大推断整个系统必定同幅增长。"}]},
 "lookup": {"title":"换表后的表示", "family":"lookup-transfer", "node":"embedding",
  "prompt":"固定嵌入表第0行为[2,−1]、第1行为[0,3]、第2行为[−2,1]。编号序列[2,0]应查出什么？解释编号与向量的关系；若重新编号词表却不调整表行，会发生什么？编号差能否直接代表语义距离？",
  "options":["[[2,−1],[−2,1]]","[[−2,1],[2,−1]]","[0,0]"], "correct":1,
  "rationale":"按顺序查第2行和第0行，得到[[−2,1],[2,−1]]。词表编号与表行映射须一致；任意编号差不是语义距离。",
  "criteria":[
   {"id":"path","title":"按序查表", "requirement":"顺序对应第2行、第0行，不排序或相加。"},
   {"id":"conditions","title":"说清映射条件", "requirement":"说明词表编号和嵌入表行必须一致；换编号需相应调整映射。"},
   {"id":"boundary","title":"区分编号与语义", "requirement":"编号是地址，编号差不能直接表示语义远近；需看学习到的表示及相应比较方式。"}]},
 "loss": {"title":"误差抵消的新情境", "family":"mse-transfer", "node":"loss",
  "prompt":"模型A对两个样本的预测误差为−3、3；模型B为2、2。按平均平方误差，哪个更小？写出比较过程。解释为什么不能先平均误差再平方，以及这个比较能否证明新数据上的表现也更好。",
  "options":["A更小","B更小","一样"], "correct":1,
  "rationale":"A的平均平方误差为9，B为4，B更小。先平均会让A的正负误差抵消。这里只比较给定样本和指定指标，不能直接证明未见数据表现。",
  "criteria":[
   {"id":"path","title":"分别平方再平均", "requirement":"给出A为9、B为4的计算，或等价推导。"},
   {"id":"conditions","title":"解释为何不能抵消", "requirement":"区分平均平方与平均后平方，指出正负误差抵消问题。"},
   {"id":"boundary","title":"限定评价范围", "requirement":"结论限于这组样本和该指标，泛化需额外独立评估。"}]},
}
