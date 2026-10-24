# -*- coding: utf-8 -*-
"""2026 节气 + 农历日期 计算（用于卡面日期号）"""
import math, json

RAD = math.pi / 180.0

def jd_from_ymd(y, m, d, h=0.0):
    if m <= 2:
        y -= 1; m += 12
    A = y // 100
    B = 2 - A + A // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + B - 1524.5 + h / 24.0

def jd_to_datetime(jd):
    """返回 (y,m,d,hh,mm) 北京时间 (UTC+8), jd 为 TT"""
    z = jd + 0.5
    Z = int(z)
    F = z - Z
    if Z < 2299161:
        A = Z
    else:
        alpha = int((Z - 1867216.25) / 36524.25)
        A = Z + 1 + alpha - alpha // 4
    B = A + 1524
    C = int((B - 122.1) / 365.25)
    D = int(365.25 * C)
    E = int((B - D) / 30.6001)
    day = B - D - int(30.6001 * E) + F
    month = E - 1 if E < 14 else E - 13
    year = C - 4716 if month > 2 else C - 4715
    di = int(day); frac = (day - di) * 24.0
    # TT -> UT  (ΔT ~ 70s for 2026) then UT -> UTC+8
    frac -= 70.0 / 3600.0
    frac += 8.0
    hh = int(frac); mm = int(round((frac - hh) * 60))
    if mm == 60:
        mm = 0; hh += 1
    if hh >= 24:
        hh -= 24
        jd2 = jd_from_ymd(year, month, di) + 1
        y2, m2, d2, _, _ = jd_to_datetime_raw(jd2)
        return (y2, m2, d2, hh, mm)
    return (year, month, di, hh, mm)

def jd_to_datetime_raw(jd):
    z = jd + 0.5
    Z = int(z); F = z - Z
    alpha = int((Z - 1867216.25) / 36524.25)
    A = Z + 1 + alpha - alpha // 4
    B = A + 1524
    C = int((B - 122.1) / 365.25)
    D = int(365.25 * C)
    E = int((B - D) / 30.6001)
    day = B - D - int(30.6001 * E) + F
    month = E - 1 if E < 14 else E - 13
    year = C - 4716 if month > 2 else C - 4715
    return (year, month, int(day), 0, 0)

def sun_apparent_longitude(jd):
    T = (jd - 2451545.0) / 36525.0
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
    M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
    Mr = M * RAD
    C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(Mr)
         + (0.019993 - 0.000101 * T) * math.sin(2 * Mr)
         + 0.000289 * math.sin(3 * Mr))
    true_lon = L0 + C
    omega = 125.04 - 1934.136 * T
    app = true_lon - 0.00569 - 0.00478 * math.sin(omega * RAD)
    return app % 360.0

def solar_term_jd(year, target_deg):
    """求太阳视黄经 = target_deg 的时刻(TT 儒略日)"""
    approx = jd_from_ymd(year, 1, 1) + (target_deg / 360.0) * 365.2422
    for _ in range(60):
        lon = sun_apparent_longitude(approx)
        diff = (lon - target_deg + 180) % 360 - 180
        if abs(diff) < 1e-8:
            break
        approx -= diff / 0.9856473
    return approx

SOLAR_TERMS = [
    ("立春", 315, "春", 1), ("雨水", 330, "春", 2), ("惊蛰", 345, "春", 3),
    ("春分", 0, "春", 4), ("清明", 15, "春", 5), ("谷雨", 30, "春", 6),
    ("立夏", 45, "夏", 1), ("小满", 60, "夏", 2), ("芒种", 75, "夏", 3),
    ("夏至", 90, "夏", 4), ("小暑", 105, "夏", 5), ("大暑", 120, "夏", 6),
    ("立秋", 135, "秋", 1), ("处暑", 150, "秋", 2), ("白露", 165, "秋", 3),
    ("秋分", 180, "秋", 4), ("寒露", 195, "秋", 5), ("霜降", 210, "秋", 6),
    ("立冬", 225, "冬", 1), ("小雪", 240, "冬", 2), ("大雪", 255, "冬", 3),
    ("冬至", 270, "冬", 4), ("小寒", 285, "冬", 5), ("大寒", 300, "冬", 6),
]

print("=== 2026 节气（北京时间）===")
terms = {}
for name, deg, season, idx in SOLAR_TERMS:
    # 小寒/大寒 在 1 月；冬至在 12 月。按黄经找 2026 年内落点
    for y in (2025, 2026, 2027):
        jd = solar_term_jd(y, deg)
        yy, mm, dd, hh, mi = jd_to_datetime(jd)
        if yy == 2026:
            terms[name] = (yy, mm, dd, hh, mi)
            print(f"{name}\t{season}{idx}\t{yy}-{mm:02d}-{dd:02d} {hh:02d}:{mi:02d}")

# ---------- 新月 (Meeus 49) ----------
def new_moon_jd(k):
    T = k / 1236.85
    jde = (2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
           - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4)
    E = 1 - 0.002516 * T - 0.0000074 * T * T
    M = (2.5534 + 29.10535670 * k - 0.0000014 * T * T - 0.00000011 * T ** 3) * RAD
    Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T
          + 0.00001238 * T ** 3 - 0.000000058 * T ** 4) * RAD
    F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T
         - 0.00000227 * T ** 3 + 0.000000011 * T ** 4) * RAD
    Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3) * RAD
    c = (-0.40720 * math.sin(Mp) + 0.17241 * E * math.sin(M)
         + 0.01608 * math.sin(2 * Mp) + 0.01039 * math.sin(2 * F)
         + 0.00739 * E * math.sin(Mp - M) - 0.00514 * E * math.sin(Mp + M)
         + 0.00208 * E * E * math.sin(2 * M) - 0.00111 * math.sin(Mp - 2 * F)
         - 0.00057 * math.sin(Mp + 2 * F) + 0.00056 * E * math.sin(2 * Mp + M)
         - 0.00042 * math.sin(3 * Mp) + 0.00042 * E * math.sin(M + 2 * F)
         + 0.00038 * E * math.sin(M - 2 * F) - 0.00024 * E * math.sin(2 * Mp - M)
         - 0.00017 * math.sin(Om) - 0.00007 * math.sin(Mp + 2 * M)
         + 0.00004 * math.sin(2 * Mp - 2 * F) + 0.00004 * math.sin(3 * M)
         + 0.00003 * math.sin(Mp + M - 2 * F) + 0.00003 * math.sin(2 * Mp + 2 * F)
         - 0.00003 * math.sin(Mp + M + 2 * F) + 0.00003 * math.sin(Mp - M + 2 * F)
         - 0.00002 * math.sin(Mp - M - 2 * F) - 0.00002 * math.sin(3 * Mp + M)
         + 0.00002 * math.sin(4 * Mp))
    # planetary corrections omitted (小量, <1min)
    return jde + c

# 以 2025 冬至所在月为 11 月，迭代构建 2025-2027 农历
def build_lunar():
    # 找 2025-12 ~ 2027-02 的所有新月
    moons = []
    k0 = int((jd_from_ymd(2025, 11, 1) - 2451550.09766) / 29.530588861) - 2
    for k in range(k0, k0 + 34):
        jd = new_moon_jd(k)
        yy, mm, dd, hh, mi = jd_to_datetime(jd)
        moons.append({"k": k, "jd": jd, "date": (yy, mm, dd), "time": (hh, mi)})
    return moons

moons = build_lunar()
print("\n=== 新月（北京时间，含时刻）===")
for mo in moons:
    if mo["date"][0] in (2025, 2026, 2027):
        print(mo["date"], f'{mo["time"][0]:02d}:{mo["time"][1]:02d}', f'k={mo["k"]}')

# 中气（用于月序：含冬至的月为 11 月）
zhongqi = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]  # 春分..大寒
def zhongqi_jd_list(y0, y1):
    out = []
    for y in range(y0, y1):
        for deg in zhongqi:
            jd = solar_term_jd(y, deg)
            out.append((jd, deg))
    return sorted(out)

print("\n=== 冬至时刻 ===")
for y in (2025, 2026):
    jd = solar_term_jd(y, 270)
    print(y, jd_to_datetime(jd))
