# Roblock v1.0 Web Prototype Package

生成日期：2026-07-25

## 版本内容

这是 Roblock v1.0 Web 原型包，当前核心为 7×9 Block Blast 消除充能 + 主角炮手自动战斗 + 能量满触发肉鸽强化。

当前普通开局保留教学盘：棋盘预摆一组可立即消除的局面，候选块为 1/3/3。后续刷新走大块池，开放棋盘下每组三个候选里至少两个偏 4/5 格，1/2 格主要用于后期补洞/救场。

本包包含：

- `index.html`
- `styles.css`
- `src/` 运行源码
- `assets/` 静态背景与生成素材
- `tests/` 自动化测试
- `scripts/` 辅助脚本
- `artifacts/qa/` 本版本过程中产出的 QA 截图与记录
- `package.json`
- `README.md`

本包排除：

- `.git/`
- `node_modules/`
- 系统缓存文件
- 历史无关工作树文件

## 本地运行

进入包目录后启动静态服务器：

```bash
python3 -m http.server 4178 --bind 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:4178/
```

## 验证

打包前全量测试通过：

```text
119/119 pass
```

注意：本包是 Web 原型交付包，不是 Cocos 正式工程包，也不是 Android/iOS 发布包。
