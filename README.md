# KenMap

[![GitHub stars](https://img.shields.io/github/stars/nvlznn/kenmap?style=social)](https://github.com/nvlznn/kenmap) · 網站：[kenmap.noky.dev](https://kenmap.noky.dev)

量測你還懂多少自己 repo 裡的程式碼。

覆蓋率工具告訴你測試碰過哪些行；KenMap 告訴你哪些模組你還解釋得出來。它一次考你一個模組，把分數記下來，並隨著底下的程式碼變動而讓分數下降——所以某個你沒跟上的 AI 改寫，會讓那個模組自己變紅。

結果是一張 repo 的熱力圖，加上一個 README 徽章。

## 安裝

KenMap 是一個 Claude Code plugin。需要 Node.js 20 以上和 git。在終端機裡：

```bash
claude plugin marketplace add nvlznn/kenmap
claude plugin install kenmap@noky
```

已經在 Claude Code 裡的話，改打 `/plugin marketplace add nvlznn/kenmap` 和 `/plugin install kenmap@noky`。

接著在任何 repo 裡：

```
/kenmap:comprehend init                    # 探測結構，談定模組邊界
/kenmap:comprehend                         # 自動選模組，考你最不熟的部分
/kenmap:comprehend <module id>             # 指定模組，用 init 談定的 id
/kenmap:comprehend <file or folder path>   # 指定模組，直接給路徑也行，不用背 id
/kenmap:comprehend web                     # 打開地圖，並顯示連結
/kenmap:comprehend reset                   # 清除這個 repo 裡 KenMap 的所有資料，重新開始
/kenmap:comprehend help                    # 顯示所有指令
```

完整操作說明（`init` 流程、地圖怎麼看、疑難排解）見 [docs/GUIDE.md](docs/GUIDE.md)。

## 更新

第三方 marketplace 預設不會自動更新。擇一：

- 手動：終端機裡 `claude plugin update kenmap@noky`，或在 Claude Code 裡 `/plugin marketplace update noky`
- 自動：`/plugin` → Marketplaces → noky → Enable auto-update

## 分數怎麼算

```
模組分數 = 最近 3 次作答的平均，每筆各自 × (1 − churn)   # 答滿 3 題才有分數
churn    = min(1, max(added, deleted) / max(舊行數, 現在行數))
```

作答評分為 0 / 0.25 / 0.5 / 0.75 / 1。churn 是從你考試當時的 commit 算到 HEAD。分數不會因為時間經過而衰減——只有程式碼真的變動才會動它。

## 設計

KenMap 不對你的 repo 做任何預設。原始碼位置、套件描述檔、語言、模組邊界，全部在執行期從 `git ls-files` 探測出來。任何語言都能用；import 連線只在語言 adapter 認得該程式碼時才畫出來，認不出來就沒有連線。

LLM 只負責出題與批改。掃描、計分、以及所有寫檔動作都是確定性的 script。

- `.kenmap.json` 放在 main 分支，保存你確認過的模組邊界。
- orphan 分支 `kenmap-data` 保存測驗紀錄、報告與徽章。每答完一題就自動推上去，網站 [kenmap.noky.dev](https://kenmap.noky.dev) 讀的就是它。
- 網站只有一個負責 GitHub 登入的小後端（`api/`），沒有資料庫。

## 開發

從本機目錄載入 plugin，改完程式在 Claude Code 裡打 `/reload-plugins` 就生效，不用改版本號：

```
/plugin marketplace add ~/dev/kenmap
/plugin install kenmap@noky
```

或只在這次 session 載入：`claude --plugin-dir .`

```bash
npm test
```

## 發版

使用者只有在版本號變了才會收到更新。發版時：

1. 同時改 `.claude-plugin/plugin.json` 和 `package.json` 的 `version`（測試會檢查兩者一致）。
2. commit、push 到 main。

## 授權

[MIT](LICENSE)
