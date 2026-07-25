# Roblock WebPrototypeV08

7×9 Block Blast 消除充能 + 主角炮手自动战斗 Web 切片。

当前普通开局保留教学盘：棋盘预摆一组“马上能消”的局面，候选块为 1/3/3，帮助玩家立刻看到消除充能。后续候选块刷新走大块池，开放棋盘下每组三个候选里至少两个偏 4/5 格，1/2 格主要用于后期补洞/救场。

## 本地运行

从 `Roblock_项目总库` 根目录运行：

```sh
python3 -m http.server 4178 --directory 04_程序代码/WebPrototypeV08
```

打开：

```text
http://127.0.0.1:4178/
```

调试空盘大块池：

```text
http://127.0.0.1:4178/?qa=normal-opening
```

## 自动化验证

```sh
cd 04_程序代码/WebPrototypeV08
/Users/ruoxipei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.js
```

2026-07-25 当前结果：

- WebPrototypeV08：`119/119 PASS`
- 390×844 浏览器截图：console errors `0`，page errors `0`

## 当前版本要点

- 棋盘：7 行 × 9 列，共 63 格。
- 能量：只有消除整行/整列获得能量，普通放置不充能。
- 多线：横竖同时消除按 Block Blast 口径 x2。
- 肉鸽：能量满后先播放满格反馈，再暂停战斗弹出三选一强化。
- 战斗：主角炮手自动攻击，强化作用在炮弹伤害、攻速、分裂、火焰爆炸等显性能力上。
- 波段：一关 6 段，怪物按时间波次推进，不等待上一波全灭。

## 390×844 浏览器截图

- 默认教学开局：`artifacts/qa/v10-guided-opening-big-refill/default-guided-opening-390x844.png`
- 空盘大块池检查：`artifacts/qa/v10-guided-opening-big-refill/normal-opening-big-pool-390x844.png`

## 证明边界

WebPrototypeV08 是本地 Web 原型验证包；不代表正式 Cocos、Android 设备或真实玩家验证完成。
