# -*- coding: utf-8 -*-
"""生成三套模式的牌库数据 + 校验原案算式 + 输出 assets/data.js"""
import json, random, collections, os

# ============ 模式一：原版朔望月（依原案反推） ============
# 原案线索：①36张=24节气+12节日 ②上半年节气逢初六/廿一，下半年逢初八/廿三
#           ③以"霜降＝九月廿三"反推 ④庄家用 清明+春分+春节=16 点
#           ⑤玩家用 除夕(6)+大雪(10)=16 点
CN = ["正","二","三","四","五","六","七","八","九","十","冬","腊"]
CN_DAY = {1:"初一",2:"初二",3:"初三",5:"初五",6:"初六",7:"初七",8:"初八",9:"初九",
          15:"十五",21:"廿一",23:"廿三",30:"三十"}

def season_of(month_cn_index):        # 农历月 → 季
    m = month_cn_index + 1
    return "春" if m in (1,2,3) else "夏" if m in (4,5,6) else "秋" if m in (7,8,9) else "冬"

M1 = []
# 节气：月序 1..12，每月两个节气
term_names = [["立春","雨水"],["惊蛰","春分"],["清明","谷雨"],["立夏","小满"],["芒种","夏至"],
              ["小暑","大暑"],["立秋","处暑"],["白露","秋分"],["寒露","霜降"],["立冬","小雪"],
              ["大雪","冬至"],["小寒","大寒"]]
for mi, pair in enumerate(term_names):
    month_cn = mi + 1
    first_half = month_cn <= 6
    days = (6, 21) if first_half else (8, 23)
    for k, name in enumerate(pair):
        d = days[k]
        mstr = str(month_cn)
        nums = [int(c) for c in (mstr + str(d))]
        M1.append({"name": name, "type": "节气", "season": season_of(mi),
                   "label": f"{CN[mi]}月{CN_DAY[d]}", "digits": nums,
                   "sum": sum(nums), "sub": f"{CN[mi]}月{CN_DAY[d]}"})

fest = [("春节",1,1),("元宵",1,15),("社日",2,2),("上巳",3,3),("端午",5,5),("七夕",7,7),
        ("中元",7,15),("中秋",8,15),("重阳",9,9),("下元",10,15),("腊八",12,8),("除夕",12,30)]
for name, m, d in fest:
    nums = [int(c) for c in str(m) + str(d)]
    M1.append({"name": name, "type": "节日", "season": season_of(m-1),
               "label": f"{CN[m-1]}月{CN_DAY[d]}", "digits": nums,
               "sum": sum(nums), "sub": f"{CN[m-1]}月{CN_DAY[d]}"})

byname = {c["name"]: c for c in M1}
print("=== 原案算式校验（模式一）===")
g = byname["清明"]["sum"] + byname["春分"]["sum"] + byname["春节"]["sum"]
print(f"  庄家：清明({byname['清明']['sum']}) + 春分({byname['春分']['sum']}) + 春节({byname['春节']['sum']}) = {g}"
      f"  {'✓ 16 点' if g==16 else '✗ 应为16'}")
h = byname["除夕"]["sum"] + byname["大雪"]["sum"]
print(f"  玩家：除夕({byname['除夕']['sum']}) + 大雪({byname['大雪']['sum']}) = {h}"
      f"  {'✓ 16 点' if h==16 else '✗ 应为16'}")
print(f"  霜降 = {byname['霜降']['sub']}  {'✓ 九月廿三' if byname['霜降']['sub']=='九月廿三' else '✗'}")
print(f"  共 {len(M1)} 张（节气{sum(1 for c in M1 if c['type']=='节气')} + 节日{sum(1 for c in M1 if c['type']=='节日')}）")

# 十六点分布
random.seed(1); N=300000
def dist(cards, label):
    ex2=ex3=0; best=collections.Counter(); none=0
    for _ in range(N):
        a,b,c = random.sample(cards,3)
        s2 = b["sum"]+c["sum"]; s3 = s2+a["sum"]
        if s2==16: ex2+=1
        if s3==16: ex3+=1
        opts=[x for x in (s2,s3) if x<=16]
        if opts: best[max(opts)]+=1
        else: none+=1
    print(f"  {label}: 明+暗 恰好16 {ex2/N*100:.1f}% ; 含公共 恰好16 {ex3/N*100:.1f}% ; 皆爆 {none/N*100:.1f}%")
    tot = sorted(best.items(), key=lambda kv:-kv[1])[:5]
    print("     最优结果 Top:", ", ".join(f"{k}点 {v/N*100:.1f}%" for k,v in tot))
dist(M1, "模式一")
print("  单张点数范围:", min(c['sum'] for c in M1), "-", max(c['sum'] for c in M1),
      "| 超过16的牌:", [c['name'] for c in M1 if c['sum']>16])

# ============ 模式二/三：朔望月·衍时（2026 真实历法） ============
# (名, 季, 序, 类型, 月号数字, 日号, 是否农历)
TERMS = [("立春","春",1,2,4),("雨水","春",2,2,18),("惊蛰","春",3,3,5),("春分","春",4,3,20),
         ("清明","春",5,4,5),("谷雨","春",6,4,20),
         ("立夏","夏",1,5,5),("小满","夏",2,5,21),("芒种","夏",3,6,5),("夏至","夏",4,6,21),
         ("小暑","夏",5,7,7),("大暑","夏",6,7,23),
         ("立秋","秋",1,8,7),("处暑","秋",2,8,23),("白露","秋",3,9,7),("秋分","秋",4,9,23),
         ("寒露","秋",5,10,8),("霜降","秋",6,10,23),
         ("立冬","冬",1,11,7),("小雪","冬",2,11,22),("大雪","冬",3,12,7),("冬至","冬",4,12,22),
         ("小寒","冬",5,1,5),("大寒","冬",6,1,20)]
FEST = [("春节","春",1,1),("元宵","春",1,15),("社日","春",2,2),("上巳","春",3,3),
        ("端午","夏",5,5),("七夕","秋",7,7),("中元","秋",7,15),("中秋","秋",8,15),
        ("重阳","秋",9,9),("下元","冬",10,15),("腊八","冬",12,8),("除夕","冬",12,29)]

def cnmonth(m): return CN[m-1] + "月"
def cnday(d):
    if d in CN_DAY: return CN_DAY[d]
    if d == 29: return "廿九"
    return str(d)

# v2.0 口径：**月号是 1–12 的单个数字，不再拆成两位**；日号仍逐位拆开。
#   例：霜降 = 10月23日 → 数字 [10, 2, 3]（旧版会拆成 [1, 0, 2, 3]）
#   这样「月」在牌面上是一个完整的时间刻度，日仍是可配对 / 可连珠的数位。
def month_digits(m): return [m]
def day_digits(d):   return [int(c) for c in str(d)]

M2 = []
for name, season, order, m, d in TERMS:
    digits = month_digits(m) + day_digits(d)
    M2.append({"name":name,"type":"节气","season":season,"order":order,"m":m,"d":d,
               "label":f"{m}月{d}日","sub":f"{m}月{d}日","digits":digits,
               "dayPoint": sum(int(c) for c in str(d)), "sum": sum(digits)})
for name, season, m, d in FEST:
    digits = month_digits(m) + day_digits(d)
    # 牌面日期前缀用「★」标记农历：写「农历」两字会在 92px 宽的牌面上折行
    M2.append({"name":name,"type":"节日","season":season,"order":0,"m":m,"d":d,
               "label":f"{cnmonth(m)}{cnday(d)}","sub":f"★{m}月{d}日","subCn":f"{cnmonth(m)}{cnday(d)}","digits":digits,
               "dayPoint": sum(int(c) for c in str(d)), "sum": sum(digits)})
print(f"\n=== 衍 / 衍时 / 衍时纪（2026 历法）=== 共 {len(M2)} 张；平均数字数 {sum(len(c['digits']) for c in M2)/len(M2):.2f}")
print("  日点范围:", min(c['dayPoint'] for c in M2), "-", max(c['dayPoint'] for c in M2))
print("  数字范围:", min(min(c['digits']) for c in M2), "-", max(max(c['digits']) for c in M2))
msum = sum(sum(c['digits']) for c in M2) / len(M2)
print(f"  单张数字之和：均值 {msum:.2f}，两张自有牌均值 {msum*2:.2f}，三张均值 {msum*3:.2f}")
print("  双数月牌（序 10–12）:", [c['name'] for c in M2 if c['m'] >= 10])

# 输出 JS
out = {"mode1": M1, "mode2": M2}
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(root, "assets", "data.js")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    f.write("// 自动生成 —— 请勿手改；见 _tools/gen_data.py\n")
    f.write("window.DECKS = " + json.dumps(out, ensure_ascii=False, separators=(",",":")) + ";\n")
print("\n已写出:", path, os.path.getsize(path), "字节")
