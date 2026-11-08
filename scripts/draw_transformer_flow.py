"""Render an original, fixed-layout teaching diagram as SVG and PNG."""

from html import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "knowledge/zh-CN/transformer/assets"
WIDTH, HEIGHT = 1520, 1080


def main():
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    if not font_path.is_file():
        raise SystemExit("Chinese font not found; select a CJK font before rendering.")
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#f7f9fc")
    draw = ImageDraw.Draw(canvas)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
           '<title>Transformer教学变体：共享前向、训练分支和生成分支</title>',
           '<desc>顶部追踪编号到分数，中间展开Pre-Norm模块，下面分别说明标签、损失、反向更新和生成。示例为一层双头小模型。</desc>',
           '<rect width="100%" height="100%" fill="#f7f9fc"/>']

    def text(x, y, value, size=21, color="#172b4d"):
        draw.text((x, y), value, font=ImageFont.truetype(str(font_path), size), fill=color)
        svg.append(f'<text x="{x}" y="{y + size}" fill="{color}" font-size="{size}" font-family="Microsoft YaHei, sans-serif">{escape(value)}</text>')

    def box(x, y, width, height, title, body, color="#e8f0fc"):
        draw.rounded_rectangle((x, y, x + width, y + height), radius=12, fill=color, outline="#8294ad", width=2)
        svg.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="12" fill="{color}" stroke="#8294ad" stroke-width="2"/>')
        text(x + 15, y + 15, title, 22)
        for i, line in enumerate(body):
            text(x + 15, y + 52 + 28 * i, line, 18)

    def arrow(x1, y1, x2, y2, color="#435c7d"):
        draw.line((x1, y1, x2, y2), fill=color, width=3)
        if x2 != x1:
            direction = 1 if x2 > x1 else -1
            points = [(x2, y2), (x2 - direction * 10, y2 - 6), (x2 - direction * 10, y2 + 6)]
        else:
            direction = 1 if y2 > y1 else -1
            points = [(x2, y2), (x2 - 6, y2 - direction * 10), (x2 + 6, y2 - direction * 10)]
        draw.polygon(points, fill=color)
        svg.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="3"/>')
        svg.append('<polygon points="' + " ".join(f"{x},{y}" for x, y in points) + f'" fill="{color}"/>')

    text(40, 25, "Transformer：先看同一条前向，再分清训练与生成", 31)
    text(40, 77, "本项目教学变体：一层 / 两个头 / d=8 / Pre-Norm / 正弦位置 / 无缓存", 20)
    text(40, 124, "共享前向：B=批次大小，T=当前长度，V=词表大小", 20)
    row = [
        ("token 编号", ["输入 [B, T]", "先明确切分规则"]),
        ("嵌入查表", ["[B, T, 8]", "编号不等于向量"]),
        ("加入位置信息", ["[B, T, 8]", "本例采用逐元素相加"]),
        ("因果 Decoder Block", ["[B, T, 8]", "只访问允许的键"]),
        ("最终归一化与输出", ["logits: [B, T, V]", "分数不是概率"]),
    ]
    for i, (title, body) in enumerate(row):
        x = 40 + i * 300
        box(x, 165, 260, 120, title, body)
        if i < 4:
            arrow(x + 264, 225, x + 296, 225)
    text(40, 320, "展开一个 Block：本例采用归一化在前的教学结构", 23)
    details = [
        ("LayerNorm", ["沿特征维归一化", "输入 → 归一化结果"]),
        ("多头注意力", ["Q/K/V · 掩码", "汇聚 → 拼接 → 投影"]),
        ("残差相加", ["加回本段输入", "恢复到 [B,T,8]"]),
        ("LayerNorm", ["进入前馈分支", "再沿特征维归一化"]),
        ("FFN", ["8 → 16 → 8", "逐位置非线性变换"]),
        ("残差相加", ["加回前馈分支输入", "输出仍为 [B,T,8]"]),
    ]
    for i, (title, body) in enumerate(details):
        x = 40 + i * 245
        box(x, 365, 215, 120, title, body, "#edf1f7")
        if i < 5:
            arrow(x + 218, 425, x + 241, 425)
    text(40, 510, "上面是模块数据流；残差的跳接公式与完整张量形状见专题正文。", 18)

    text(40, 567, "训练分支：用真实序列构造下一位置的监督信号", 24, "#245a40")
    box(40, 615, 430, 125, "下一位对齐", ["输入 [1,2,3,4,5]", "目标 [2,3,4,5,6]"], "#e4f3e9")
    box(540, 615, 430, 125, "交叉熵损失", ["共享前向 logits + 对应目标", "只聚合有效监督位置"], "#e4f3e9")
    box(1040, 615, 430, 125, "反向与更新", ["求梯度 → 优化器更新参数", "训练损失 ≠ 独立测试质量"], "#e4f3e9")
    arrow(475, 677, 535, 677)
    arrow(975, 677, 1035, 677)

    text(40, 795, "生成分支：只用当前前缀，选择一个新单位再继续", 24, "#78541a")
    box(40, 845, 430, 125, "当前前缀", ["例如 [1,2]", "执行共享前向"], "#fff1d8")
    box(540, 845, 430, 125, "选下一 token", ["取最后位置的 logits", "本例 argmax，不回传梯度"], "#fff1d8")
    box(1040, 845, 430, 125, "追加并重复", ["例如 [1,2] → [1,2,3]", "受位置表长度与步数限制"], "#fff1d8")
    arrow(475, 907, 535, 907)
    arrow(975, 907, 1035, 907)
    text(40, 1010, "阅读入口：知识总览 → 模块专题 → 可运行实验 → 独立挑战 → 个人图谱修订", 21)
    text(40, 1045, "仅为教学小模型：没有真实分词、预训练、独立测试结论或现代大模型能力认证。", 17)
    svg.append("</svg>")
    (OUT / "flow.svg").write_text("\n".join(svg), encoding="utf-8")
    canvas.save(OUT / "flow.png")
    print("Wrote flow.svg and flow.png")


if __name__ == "__main__":
    main()
