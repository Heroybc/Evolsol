# 衍时纪 · 朔望月

二十四节气与十二节日的卡牌游戏。原生 JavaScript，无构建步骤，双击 `index.html` 即可运行。

**在线试玩（哔哩哔哩 Toy）：<https://www.bilibili.com/toy/Evolsol/index.html>**

![衍时纪 · 朔望月 封面](toy-poster-1200x900.png)

## 玩法

一副 36 张牌：24 张节气牌加 12 张节日牌，春、夏、秋、冬作为四种花色。每张牌的月号、日号会拆成多个数字，同一批数字可以跨牌型重复使用，因此一手牌能同时成立多种牌型，所有成立牌型一起计分。

游戏包含四个模式：

| 模式 | 人数 | 说明 |
| --- | ---: | --- |
| 原 · 朔望月 | 2–5 | 中文日期牌库，与固定的庄家「地猴」单挑，爆线 16 |
| 衍 · 朔望月 | 2–5 | 阿拉伯数字牌库，多人下注，前 3 回合比牌型、后 3 回合比点数，爆线 20 |
| 衍时 · 朔望月 | 2–5 | 在「衍」的基础上加入过去 / 现在 / 未来三时公共牌，庄家可以改判 |
| 衍时纪 | 1 | 小丑牌式闯关：8 大轮 × 3 关，用牌型、倍率与节令牌构筑撞开目标分 |

## 本地运行

直接双击根目录的 `index.html`。项目不使用 ES Modules，也不依赖远程资源，支持 `file://` 打开。

## 测试与打包

需要 Node.js：

```bash
node _tools/test_game.js
node _tools/pack_toy.js
```

`pack_toy.js` 会把运行所需文件复制到 `dist/` 并检查 Toy 平台要求的相对路径、入口文件和资源引用。

重新生成 ZIP 需要 Python 与 Pillow：

```bash
python _tools/pack_and_cover.py
```

## 目录

```text
index.html                 页面入口
styles.css                 界面样式
assets/                    牌库、引擎、界面逻辑、音效与美术资源
_tools/test_game.js        无头回归测试
_tools/pack_toy.js         Toy 打包与静态检查
_tools/pack_and_cover.py   ZIP 打包与备用封面生成
衍时纪-朔望-规则.md         完整规则书
```

## 许可

本项目公开源代码，但**不允许商业使用**。适用 **PolyForm Noncommercial License 1.0.0**，完整条款见 [LICENSE](LICENSE)。

允许个人学习、研究、实验、私人娱乐、非商业爱好项目，以及慈善、教育、公共研究、公共安全、公共卫生、环境保护和政府机构等非商业组织使用。公司内部使用、对外收费、商业发行、商业托管或以本项目为基础提供商业服务，均需事先取得版权持有人的书面商业授权。

因为限制使用领域，这个许可**不属于 OSI 定义下的开源许可**；准确说法是“源码公开 / source-available”。

Required Notice: Copyright (c) 2026 上海阖苑仙荣华智能科技有限公司
